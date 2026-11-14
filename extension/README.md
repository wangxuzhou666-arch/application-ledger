# Approved application preparation — v0.1

A local Chrome Manifest V3 extension for official Greenhouse and Ashby application
pages. It reads an **already approved** application packet, verifies the PDF in
Python and again in the browser, attaches it, fills explicitly confirmed answers,
then records a readback snapshot in Application Ledger. **There is no submit API
or submit button in the extension.**

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
3. Prepare the answer file using `answers.example.json`. Only add facts the
   applicant has actually confirmed. Exact visible labels and control kinds are
   required. Common fields are optional if absent; unknown required questions
   remain pending. Job-specific entries override common labels.
4. In Chrome's extension manager enable Developer mode, choose **Load unpacked**,
   and select this `extension` directory. Copy its extension ID.
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
   replaced. Page parsing is allowed to settle before filling.
5. Text/textarea, native select, grouped radio and ARIA-bound combobox are supported.
   Custom controls without unambiguous accessible labels are left for inspection.
6. Values are re-read after filling and settling; the attached File's bytes are
   hashed again, and the page must also visibly show the filename.
7. Unknown required inputs, validation errors, unresolved fields and visible
   CAPTCHA widgets prevent a clean readback result.
8. Only result counts/status are persisted in `preparation_runs`. The popup retains the public job identity, timestamp and counts in session storage;
   no field values, PDF bytes or applicant contact data go into extension storage/reports.
   The existing job stage remains `approved`; no application receipt is created.

A successful readback is a **point-in-time DOM snapshot**, not proof of server-side
file processing or application acceptance. The page may change later. Native
Messaging delivery and installation in a particular Chrome profile require a
separate smoke test.

## Deliberate limitations

- Official top-level ATS pages only. Company-hosted cross-origin embedded forms,
  multi-page navigation, closed shadow DOM, unlabelled widgets and file controls
  removed by the ATS are left for manual inspection.
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

```sh
PYTHON_DOTENV_DISABLED=1 python3 -B -m unittest discover -v
node --test extension/tests/*.test.cjs
python3 -B -m http.server 43891 --bind 127.0.0.1 --directory extension
```

Open `http://127.0.0.1:43891/tests/fixtures.html` and press **运行验收测试**.
This exercises the same upload/fill/readback code with synthetic File bytes,
Greenhouse-style fields and Ashby-style comboboxes. It does not load the extension
into Chrome or call a real employer. Tests cover parser overwrite, delayed drift,
duplicate labels, wrong job/hash, existing attachments and zero submit events.

See [REVIEW.md](REVIEW.md) for review scope and known acceptance gaps.

## References

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome content scripts and isolated worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [File input restrictions](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)
