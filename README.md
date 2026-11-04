# Application Ledger

Keep a history of every job you pursued, which résumé you approved, and how you know an application reached the employer. A small local CLI for applicants and the browser assistants they use. Python 3.9+, standard library. MIT licensed.

## First application

Run these commands from the repository. Replace the example company and requisition with the employer and job ID. Use a stable personal identifier for postings without a requisition. The database defaults to a private directory under your home folder. Pass `--db PATH` before a command to select another database.

```sh
python3 ledger.py add Example R1 "Technical Product Manager" --url https://example.org/jobs/R1
python3 ledger.py prepare Example R1 /path/to/reviewed.pdf
# After reviewing that job and file, pass the printed SHA-256 digest:
python3 ledger.py approve Example R1 /path/to/reviewed.pdf REVIEWED_DIGEST
# Immediately before your browser submits the application:
python3 ledger.py begin Example R1 /path/to/reviewed.pdf
# After the employer confirms receipt:
python3 ledger.py receipt Example R1 receipt "Employer portal confirmation"
python3 ledger.py stage Example R1 assessment "Take-home invitation received"
python3 ledger.py stage Example R1 interview "First round scheduled"
python3 ledger.py history Example R1
python3 ledger.py list
```

If you applied yourself, use `submitted-elsewhere Example R1 user "Applicant confirmed"` after adding the job. Stages include leads, holds, skipped and closed listings, review, approval, uncertain submission, applied, assessment, interview, offer, accepted, rejected, paused and withdrawn. Additional interview rounds can have separate dated notes. A changed PDF requires another approval. If the network drops after begin, check the portal or receipt before doing anything else. Case-insensitive employer + requisition identifies one position.

## Start from an existing tracker

`python3 ledger.py import my-jobs.csv` imports a UTF-8 CSV with headers `company,req,title,url,stage,note`. Pipe a CSV to `import -` to avoid writing an intermediate file. Each imported event records the time of observation, not an inferred application date. Importing the same snapshot again creates no duplicate events. A conflicting backwards transition aborts the whole import so you can reconcile the source. Do not commit personal exports or receipts.

## Discover jobs and fill approved forms

`python3 discover.py greenhouse COMPANY --contains product` or `python3 discover.py ashby COMPANY --contains agent` prints public postings and IDs. Verify eligibility, start window, pay, title and the live form before queuing any role. Use the company's application page if its API is unavailable.

`fill-reviewed-fields.js` is a browser assistant helper. Load the function in a tab session exposing Playwright-style locators and call `fillReviewedFields(tab, [{kind:"text", label:"First Name", value:"Example"}])`. It reads the selected value back, returning completed and unresolved labels. An operator or a connected assistant handles uploads, dynamic controls, consent, the final click, and the receipt. The CLI itself never sends personal data to employers. Scheduled monitoring and email inbox access require a separate integration.

## Development and prior art

Run `python3 -B -m unittest -v`. The tests use an in-memory database. Private files belong outside the checkout. The Git allowlist is an extra guard.

Design references: [Muse application workflow](https://github.com/Dark417/muse-auto-job-apply) for queued browser tasks; [JobOps](https://github.com/DaKheera47/job-ops) for separating discovery and post-application tracking; [Job Application Tracker](https://github.com/waddington/job-application-tracker) for recording multiple interview rounds. This implementation does not vendor code from those projects. Public discovery uses the [Greenhouse](https://docs.greenhouse.io/job-board.html) and [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api) board APIs.
