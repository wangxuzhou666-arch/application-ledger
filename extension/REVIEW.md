# Review handoff — prepare-only extension

## Review objective

Review attachment integrity, employer/job isolation, approved-answer boundaries and
the distinction between preparation and submission. This branch adds a local MV3
extension; it must never submit a new application.

## Read in order

1. `prepare_bridge.py`: native protocol, path containment, packet/approval checks,
   master tracker deduplication, chunking, run binding, report validation
   (`clean_report`: counts plus whitelisted reason codes) and the read-only `scan`
   operation (`clean_scan`, identity-derived filename under the private `scan_dir`).
2. `extension/background.js`: tab targeting, binary reconstruction, bridge
   messaging, error handling and memory lifetime.
3. `extension/content.js`: exact field matching, file selection, React-compatible
   input events, combobox opening/closing, formless Yes/No buttons, the two file
   verification paths, `questions()` (required/unanswered counting and scan) and
   CAPTCHA challenge detection.
4. `board.py` diff: preparation snapshots only; existing application stages remain
   unchanged.
5. Tests and installation docs.

## Author's review fixes before handoff

- A file input containing bytes is not enough: also require the filename in the
  rendered page, and keep the result separate from a server receipt.
- Bind runs to the approved packet token, PDF digest, exact ATS identity and
  reviewed-answer digest. Recheck between chunks and before report persistence.
- Refuse a second concurrent preparation of the same job.
- Refuse ambiguous field labels, non-bound combobox options and existing attachments.
- Do not treat a selected member's sibling radio buttons as unanswered required
  fields. Include hidden required file controls and native input validity.
- Record failures separately; a dashboard export failure must not replay upload.
- Keep all real application data and installed host configuration outside Git.
- Verify approval again immediately before injecting into the page, after PDF transfer.
- Do not show a previous tab snapshot for a different job or a preparation badge
  as the current status of an already-submitted job.
- Bound reads themselves, not only an earlier file-size stat.

## v0.2 changes (fix plan of 2026-11-14)

1. Greenhouse dropdowns. The live page wraps react-select and owns `menuIsOpen`;
   it opens on `keyup` (Escape/Tab close, any other key except Enter opens), so
   v0.1's click and typing never opened it. The adapter now sends one ArrowDown
   keystroke (keydown + keyup), which opens both that wrapper and plain
   react-select, waits for `aria-controls`, reads the choice back from the shown
   single value, and closes the menu with Escape after a failed or abandoned pick.
2. Status and reasons. The reCAPTCHA badge no longer forces `needs_attention`.
   Reports carry `unansweredRequired` (required questions still empty) and
   `reasons` (fixed codes, whitelisted by the bridge, shown in Chinese by the popup
   and dashboard) instead of the single `unknownRequired` count. v0.1 rows in
   `preparation_runs` still render.
3. Ashby Yes/No buttons: detected per field block, required from the label class,
   counted when unanswered, and fillable only through formless buttons with a
   readable `aria-pressed`.
4. Upload verification no longer depends on the input keeping its File; cleared or
   replaced inputs fall back to the filename shown inside the resume field. The
   existing-attachment check also looks for a shown filename or remove button.
5. Read-only scan operation (popup button, `LedgerPrep.scan`, bridge `scan`).
6. Whole-word protected labels (now also Hispanic/Latino, sex, transgender), one
   pattern shared by Python and JS with a cross-check test; URL fragments are
   ignored for identity in both; `focusout` is dispatched after text input;
   README documents pinning the extension ID with a private manifest `key`.

## Test evidence and limits

The v0.2 local suite has 35 passing Python tests (including the real stdio host
subprocess and installer in an isolated synthetic directory), 13 passing Node tests,
and 25 passing browser-fixture scenarios (the 10 v0.1 scenarios plus 15 new). Node
tests also exercise background orchestration, SHA failures, navigation, interrupted
uploads and the scan path. The browser fixture uses the actual adapter with synthetic
data, loads real React/react-select from a pinned CDN build, and counts submit events
on `window` before the adapter's own guard: zero. Ten new adapter guards and eight new bridge
checks were each removed in a scratch copy to confirm a targeted test fails without them
(adapter mutants ran before the last close-menu/typing fix, which has its own regression scenario).

A read-only re-probe of one public Greenhouse page and one public Ashby page (no
file, no typing, no submit; one neutral "Yes" chosen through `fill()` in a throwaway
headless context) confirmed: the Greenhouse dropdown opens and its option is found
in the bound listbox and read back; the reCAPTCHA badge is not counted; the Ashby
Yes/No question is detected as an unanswered required question and its formless
button reads back through `aria-pressed`. Every menu the adapter opened closed on the first
Escape; the only expanded combobox left on Greenhouse is the phone widget's own country
search (`iti-0__search-input`), which the adapter never touches. The probe injected the
adapter with `page.evaluate` (main world), not as an installed extension.

**Not yet established by these tests:** Chrome's installed Native Messaging wiring;
whether real ATS pages keep, clear or replace the file input after a real upload
(both fallbacks are only fixture-tested); what Greenhouse/Ashby show after upload
(filename text, remove button); real-page menu behaviour when the popup holds focus
instead of the tab; network-backed comboboxes (location, school); other employer
themes; live ATS server upload acceptance; cross-origin embeds; future DOM changes.
Do not describe this branch as production-validated on real employers. Real
application testing requires a separately authorized job and attachment; this
implementation task forbids new submissions.

## Suggested independent review probes

- Revoke or mutate a packet during chunk transfer; change the reviewed answers.
- Try another company with the same numeric requisition ID.
- Change ATS route while filling; rerender/remove the resume input.
- Duplicate label text, delayed parser resets, a custom button pretending to be a
  combobox, a required hidden file control, and an upload error outside aria-live.
- A Yes/No pair inside a `<form>`, a third button in the Yes/No container, a page
  that keeps both buttons `aria-pressed="false"` after a click.
- A react-select with `escapeClearsValue`, a multi-select, an async option list
  that loads after the 1.1 s wait.
- A scan payload with an extra key, a value field, 151 questions or a path; a
  missing or non-directory `scan_dir`.
- Kill/restart the extension worker or native host mid-upload. Confirm there is no
  automatic retry or job-stage promotion.
- Verify packaging contains only generic code/synthetic examples.
- Inspect whether accessible-label exact matching is sufficiently robust on real
  pages before widening adapter selectors.

Do not access private resumes, answers, mail, browser credentials or the real
tracker when running the public test suite. Do not submit applications as a test.
