# Approved application preparation — v0.2

A local Chrome Manifest V3 extension for official Greenhouse and Ashby application
pages. It reads an **already approved** application packet, verifies the PDF in
Python and again in the browser, attaches it, fills explicitly confirmed answers,
then records a readback snapshot in Application Ledger. A second, read-only action
exports the page's question list so answers can be drafted before approval.
**There is no submit API or submit button in the extension.**

## Layout and data boundaries

| Location | Purpose |
| --- | --- |
| `extension/` | Public extension, installer, synthetic browser fixtures |
| `prepare_bridge.py` | Local native-messaging host, approval / PDF / tracker checks |
| `test_prepare_bridge.py` | Synthetic bridge and state-transition regression tests |
| `board.py` | Existing dashboard plus separate preparation snapshots |
| Outside this repository | Actual packets, PDFs, answer map, tracker, SQLite DB and rendered personal dashboard |

No LLM, remote server, analytics, account cookies or API key is required. The bridge
uses Chrome Native Messaging, not a public HTTP service. The extension can only
run on the four official ATS hosts declared in its manifest; it has no access to
LinkedIn or arbitrary browsing pages. It processes the active tab when clicked.
An attachment change can upload a file to the employer immediately, even without
submission. Use it only for a specifically approved job and PDF.

## Install on macOS or Linux

1. Use Python 3.9+ with `openpyxl` available. Keep dependencies outside synced
   Desktop/Documents directories.
2. Copy `config.example.json` to a private directory outside the repository.
   Set absolute paths to your existing ledger, resume root, applied tracker,
   reviewed answer map and dashboard. The example paths are placeholders.
   `scan_dir` is optional: an existing private directory for question scans
   (see below). Without it the scan action is refused.
3. Prepare the answer file using `answers.example.json`. Only add facts the
   applicant has actually confirmed. Exact visible labels and control kinds are
   required: `text`, `select` (native), `radio`, `combobox` (ARIA or react-select
   dropdown; the value is the exact option text) and `yesno` (Ashby Yes/No
   buttons; the value is exactly `Yes` or `No`). Common fields are optional if
   absent; unknown required questions remain pending. Job-specific entries
   override common labels.
4. In Chrome's extension manager enable Developer mode, choose **Load unpacked**,
   and select this `extension` directory. Copy its extension ID. To keep the ID
   stable across reloads or machines, see *Pinning the extension ID* below.
5. Install the local host using the same Python that has openpyxl:

   ```sh
   PYTHON_DOTENV_DISABLED=1 python3 -B extension/install_host.py \
     --extension-id YOUR_32_CHARACTER_ID --config /absolute/private/config.json
   ```

   The installer creates a per-user launcher/config in
   `~/.application-ledger/native/` and a Chrome NativeMessagingHosts manifest.
   It does not edit Chrome preferences, install itself into Chrome, open jobs,
   upload resumes or submit applications. The host permits only that extension ID.
6. Open the job's official application page. Use the popup **核对并填写当前页**.
   Read the result and inspect the page. Do not rerun blindly after an interruption.

If the unpacked extension ID changes, rerun the installer for the new ID. This
version does not support Windows registry installation or enterprise-blocked
extension/native-host policies.

### Pinning the extension ID

An unpacked extension's ID is derived from its directory path unless the manifest
has a `key`. Chrome documents a fixed ID from a public key
([manifest `key`](https://developer.chrome.com/docs/extensions/reference/manifest/key)).
Never commit a key: `extension/**` is tracked, so make a private copy first.

```sh
cp -R extension /absolute/private/application-ledger-extension
cd /absolute/private
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem   # keep private
openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A    # value for "key"
openssl rsa -in key.pem -pubout -outform DER | shasum -a 256 | head -c32 | tr 0-9a-f a-p  # expected ID
```

Add `"key": "<base64 value>"` to the copy's `manifest.json`, load that copy, and
check that Chrome shows the expected ID before running the installer with it. The
commands were run locally; Chrome's acceptance of the key was not tested here.

## Existing packet and approval integration

Before browser use, run the existing `flow.packet → flow.approve` workflow.
The extension never grants approval itself. The disk packet must be at either
`<resume_root>/<company>/application_packet.json` or
`<resume_root>/<company>/_source/application_packet.json`, with:

```json
{
  "company": "Example",
  "req": "123",
  "url": "https://job-boards.greenhouse.io/example/jobs/123",
  "pdf": "/absolute/private/resumes/Example/approved.pdf",
  "sha256": "THE_ACTUAL_64_CHARACTER_SHA256",
  "status": "approved_pending_submission",
  "submission_authorized": true
}
```

The ledger must contain the matching approved job, token, approval event and PDF
digest. The PDF must be inside the configured resume root, under a company
directory, and be at most 8 MiB. Resolved paths outside that root, including
escaping symlinks, are refused. Both employer board and requisition ID are bound
to the current HTTPS page. Applied, awaiting-receipt, skipped, hidden and blocked
jobs cannot be prepared.

The current private tracker integration expects the existing
`投递去重统计` sheet and its
`去重键 / 公司 / 准确岗位 / 岗位编号／标识 / 计入累计` headers.
It fails closed if that sheet cannot be read. An unrelated tracker format needs an
explicit adapter; do not disable this check.

## What is verified

1. Host rechecks approval, authoritative applied tracker, disk packet and SHA256.
2. Host returns PDF bytes in bounded chunks, bound to a ten-minute run.
3. Extension checks the assembled bytes; the content adapter checks them again.
4. Resume input is selected unambiguously. An existing attachment is not silently
   replaced: the input must hold no file, and the resume field must show no
   document filename (`.pdf/.doc/.docx/.rtf/.txt`) and no remove/delete button.
   Page parsing is allowed to settle before filling.
5. Supported controls: text/textarea, native select, grouped radio, combobox and
   Yes/No buttons. Custom controls without unambiguous labels are left for inspection.
   - **Combobox.** If the listbox is already bound while closed (Ashby style), the
     adapter clicks and types the value as before. Otherwise (react-select, as on
     Greenhouse) it sends one ArrowDown keystroke, keydown then keyup, and waits
     for `aria-controls`. Plain react-select opens on keydown; Greenhouse's wrapper
     controls `menuIsOpen` itself and opens on keyup. The option must come from the
     bound listbox with exact, unique text. Readback uses the input value, or when
     that is empty the single shown value in the same control. A failed or abandoned
     pick closes the menu with Escape. Enter is never sent.
   - **Yes/No (Ashby).** Two buttons in one container with text exactly `Yes` and
     `No`, under a field label that matches exactly once. The button must have no
     owning `<form>` (Ashby's are `type=submit` but formless), so a click cannot
     submit. Readback uses `aria-pressed`, the state observed on Ashby. Without a
     readable pressed state the answer counts as unverified.
6. Values are re-read after filling and settling. File verification has two paths:
   - The page still holds the File (original or replacement input): its name,
     size and SHA256 are checked again, and the filename must also be shown inside
     the resume field.
   - The page cleared or replaced the input: the filename shown inside the resume
     field is the evidence (`fileVerified` with reason `file_input_reset`); if it is
     not shown, `file_not_shown`. The filename check is limited to the resume field,
     not the whole page.
7. Status `verified` means: every reviewed answer read back, the file check passed,
   `unansweredRequired` is 0, and no reason code other than `file_input_reset` is
   present. `unansweredRequired` counts required questions that are still empty,
   including Ashby questions marked required only by a label class. A required
   question that the page pre-filled but that has no reviewed answer is reported as
   `unknown_required` without counting as unanswered.
8. Only counts, status and fixed reason codes are persisted in `preparation_runs`.
   The popup retains the public job identity, timestamp, counts and reason codes in
   session storage; no labels, field values, PDF bytes or applicant contact data go
   into extension storage or reports. The existing job stage remains `approved`; no
   application receipt is created.

### Reason codes

The bridge accepts only these codes; the popup and dashboard show them as short
Chinese sentences.

| Code | Meaning | Blocks `verified` |
| --- | --- | --- |
| `file_not_shown` | The resume field does not show the filename | yes |
| `file_input_reset` | Input cleared/replaced; verified by the shown filename | no |
| `file_mismatch` | The input holds a file that is not the approved PDF | yes |
| `captcha_challenge` | A CAPTCHA the applicant must complete is visible | yes |
| `page_error` | A visible alert, invalid field or error message | yes |
| `unknown_required` | A required question has no reviewed answer | yes |
| `unanswered_buttons` | A required Yes/No question is unanswered | yes |
| `field_readback_failed` | A reviewed answer failed to fill or read back | yes |
| `combobox_unbound` | A combobox never exposed a bound listbox | yes |
| `option_not_found` | The option is missing or not unique | yes |

The invisible-mode reCAPTCHA badge (`.grecaptcha-badge` and its anchor iframe,
always visible on Greenhouse) is not a challenge. A visible checkbox widget or
challenge frame (reCAPTCHA, hCaptcha, Turnstile) is.

## Read-only question scan

The popup's **扫描题目** button lists the questions on the current official page
so answers can be drafted from a few KB of text. It does not need an approved
job, issues no PDF, creates no preparation run, uploads nothing and fills nothing.
For each question it exports `label`, `kind` (`text`, `select`, `radio`,
`combobox`, `yesno`, `checkbox`, `file`, `unsupported`), `required`, `protected`
and up to 30 `options` (`optionsTruncated` marks more). It never exports a value.
Combobox options are read by opening the menu and closing it again, except for
protected questions and network-backed searches (labels containing location, city,
school, university, college, institution or address), which get `options: null`
and are not touched.

The bridge accepts a scan only for a supported job URL, validates its structure
and size (at most 150 questions, labels up to 300 characters, options up to 150),
recomputes `protected` itself and writes `<scan_dir>/<provider>.<board>.<job>.json`.
The filename comes from the canonical job identity only; no browser-supplied path
is accepted. To turn a scan into answers, copy confirmed facts into the private
answer file with the exact label, kind and option text.

A successful readback is a **point-in-time DOM snapshot**, not proof of server-side
file processing or application acceptance. The page may change later. Native
Messaging delivery and installation in a particular Chrome profile require a
separate smoke test.

## Deliberate limitations

- Official top-level ATS pages only. Company-hosted cross-origin embedded forms,
  multi-page navigation, closed shadow DOM and unlabelled widgets are left for
  manual inspection. A URL `#fragment` is ignored when computing the job identity.
- Multi-select comboboxes and network-backed searches whose option only appears
  after typing (for example Greenhouse location and school) are not filled; they
  stay pending with `option_not_found`.
- Protected labels are matched by whole word (privacy, consent, agreement,
  signature, certify, attestation, CAPTCHA, race, ethnicity, Hispanic/Latino,
  gender, sex, disability, veteran). They are never filled.
- No automatic consent, electronic signature, CAPTCHA, demographic answer,
  invented eligibility answer, application submission or receipt verification.
- No resume rewriting, default PDF substitution or modification of approved files.
- No browser-wide watchdog. Dynamic updates after the bounded observation window
  may invalidate the snapshot.
- Rendering failure does not cause a re-upload: the result remains in SQLite and
  the existing workbench's `board` command can refresh the HTML.
- A crash may leave a `started` run for up to ten minutes. Inspect the old page
  before restarting. Completed snapshots are never evidence of submission.

## Testing

Use synthetic fixtures only. Python requires openpyxl (`pip install -r extension/requirements-test.txt`); JavaScript tests require Node 20+. Point temporary files at a nonsynced artifact directory.
The browser fixture page loads pinned React 18.2.0 and react-select 5.8.0 ESM builds
from cdn.jsdelivr.net, so it needs network access to that CDN.

```sh
PYTHON_DOTENV_DISABLED=1 python3 -B -m unittest discover -v
node --test extension/tests/*.test.cjs
python3 -B -m http.server 43891 --bind 127.0.0.1 --directory extension
```

Open `http://127.0.0.1:43891/tests/fixtures.html` and press **运行验收测试**.
This exercises the same upload/fill/readback/scan code with synthetic File bytes,
Greenhouse-style fields, real react-select (both Greenhouse's controlled wrapper
and plain), Ashby-style comboboxes and formless Yes/No buttons. It does not load
the extension into Chrome or call a real employer. Tests cover parser overwrite,
delayed drift, duplicate labels, wrong job/hash, existing attachments (file,
shown filename, remove button), inputs cleared or replaced after upload, missing
and duplicate options, the reCAPTCHA badge versus a challenge, and zero submit
events (counted before the adapter's own submit guard).

See [REVIEW.md](REVIEW.md) for review scope and known acceptance gaps.

## References

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome content scripts and isolated worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [File input restrictions](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)
