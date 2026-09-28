# Verification scope

The runnable checks live in the repository; GitHub Actions reports their result for each revision.

| Area                 | Check                                                                 | Boundary                                                                |
| -------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Attendance and dates | Deterministic unit tests, explicit clock, DST and boundary cases      | Configured planning policy, not official university sanctions           |
| Imports              | CSV/ICS identity, reimport, cancellation, invalid dates, input limits | Deliberate subset of calendar formats; no recurrence expansion          |
| Storage              | Browser reload, validated export/restore, reset/recovery              | One browser origin and profile                                          |
| Failure handling     | Injected failed read and aborted write against actual IndexedDB       | Synthetic failures, not every operating-system quota/eviction condition |
| Concurrency          | Second-tab exclusion and reopening after lock release                 | Single active editor; no cross-device conflict merging                  |
| UI                   | Real-browser core workflow and 320/390/768/1024px overflow checks     | Chromium automation; not a complete accessibility audit                 |
| Privacy              | Browser core workflow blocks and counts external requests             | Source and workflow evidence; no independent security certification     |

Tests use fictional data and disposable browser contexts. The production preview is started on loopback port 5189 and stopped by the test runner. Tests do not connect to the private prototype or provider accounts.

`node tests/dev-startup.mjs` also checks development-mode startup and reload on port 5190, guarding against React StrictMode competing with itself for the editor lock.

Browser tests fix the clock to September 28, 2026 so tests and documentation captures remain reproducible as real dates pass. The ordinary app generates examples relative to the actual date.

To regenerate the documentation captures on Windows PowerShell:

```powershell
$env:CAPTURE_DOCS = '1'
npm run test:browser
Remove-Item Env:CAPTURE_DOCS
```

On a POSIX shell: `CAPTURE_DOCS=1 npm run test:browser`.

Do not substitute screenshots for functional evidence. They show a particular fictional example and viewport, not correctness across all states. No independent adoption or measured personal time-saving results are included.
