# Review handoff — prepare-only extension

## Review objective

Review attachment integrity, employer/job isolation, approved-answer boundaries and
the distinction between preparation and submission. This branch adds a local MV3
extension; it must never submit a new application.

## Read in order

1. `prepare_bridge.py`: native protocol, path containment, packet/approval checks,
   master tracker deduplication, chunking, run binding and report persistence.
2. `extension/background.js`: tab targeting, binary reconstruction, bridge
   messaging, error handling and memory lifetime.
3. `extension/content.js`: exact field matching, file selection, React-compatible
   input events, combobox scope, wait/readback and unknown required fields.
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

## Test evidence and limits

The final local suite has 26 passing Python tests (including the real stdio host
subprocess and installer in an isolated synthetic directory), 9 passing Node tests,
and 10 passing browser-fixture scenarios. Node tests also exercise background
orchestration, SHA failures, navigation and interrupted uploads. The browser fixture uses the actual adapter
with synthetic data and records zero submission events.

**Not yet established by these tests:** Chrome's installed Native Messaging wiring,
all employer-specific Greenhouse/Ashby themes, live ATS server upload acceptance,
cross-origin embeds, and future DOM changes. Do not describe this branch as
production-validated on real employers. Real application testing requires a
separately authorized job and attachment; this implementation task forbids new
submissions.

## Suggested independent review probes

- Revoke or mutate a packet during chunk transfer; change the reviewed answers.
- Try another company with the same numeric requisition ID.
- Change ATS route while filling; rerender/remove the resume input.
- Duplicate label text, delayed parser resets, a custom button pretending to be a
  combobox, a required hidden file control, and an upload error outside aria-live.
- Kill/restart the extension worker or native host mid-upload. Confirm there is no
  automatic retry or job-stage promotion.
- Verify packaging contains only generic code/synthetic examples.
- Inspect whether accessible-label exact matching is sufficiently robust on real
  pages before widening adapter selectors.

Do not access private resumes, answers, mail, browser credentials or the real
tracker when running the public test suite. Do not submit applications as a test.
