# Expense Logger long-horizon plan

Status: planning only. Current shipping version on `main` is **1.9.1** (merge of PR #28, `a52bdc8`). There is no root README, no `AGENTS.md` / `CLAUDE.md` / `.cursor` rules file, and no open GitHub issues or pull requests. The only product notes in the repo are `DEEPSEEK-NOTES.md` (original brief and v1.0.x QA) and `icons/README.md`.

This plan is a queue of small, independently reviewable releases for a cheaper coding model. A human merges them in order. Do not start a later step until the previous version is on `main`.

Each step is one PR and one version bump. Prefer under **400 changed lines**. If a step grows past that, stop and split it; do not widen the behavior.

---

## How to read labels

- **Found** — behavior, comment, or follow-up that is in this repo or in a merged PR.
- **Suggestion** — not requested in the repo. Skip it if the human has not answered the matching open question.

## Assumptions

1. The user is the person who imports their own bank CSV and Chase card CSV on an iPhone Home Screen install. The live site is the GitHub Pages URL recorded in `DEEPSEEK-NOTES.md` (`https://nixcapital.github.io/expense-logger/`). The device is the source of truth.
2. Versions keep the existing pattern: patch for a fix (`1.7.4`, `1.9.1`), minor when the user-visible behavior is a feature (`1.8.0` card owed, `1.9.0` edit-flow). This queue uses that same rule.
3. PRs land **one at a time onto `main`**, in the order below. Parallel branches will conflict on the version strings.
4. Saved data already on phones must keep working. New fields are optional. No `expenseLogger.*` key is renamed. `BACKUP_FORMAT` 1 and 2 still restore.
5. Passcode lock stays removed (PR #28). Do not bring it back.
6. Nothing in this queue adds a server, analytics, or account sync. The app may keep using the system share sheet and file download, which it already does for backups, CSV, and Spending Wrapped images.
7. Tests stay as `node scripts/<name>.mjs` with Playwright where the script already uses it (`playwright@1.49.1` is what PR #2 documented). Forecast math belongs in `forecast.js` unit tests. Do not add a bundler, framework, or `package.json` unless a step says so.
8. QA viewport used by existing scripts is **428×926**. Behavior tests matter more than new screenshots. Add a screenshot script only when a step changes layout.
9. Line numbers below are from 1.9.1 and will drift. Search for the function name.
10. “Composer” means the model implementing one step. It must not do the next step in the same PR.

## What is already built

Static PWA. No build step. Global scripts, not ES modules, except the Node tests.

| File | Role |
| --- | --- |
| `index.html` | Screens, sheets, `?v=` cache-bust on assets |
| `styles.css` | Dark-first iOS layout. Header comment carries the version |
| `app.js` | UI, `localStorage`, IndexedDB receipts, import, backup |
| `forecast.js` | Pure cash-flow math. `module.exports` and `window.ExpenseForecast` |
| `wrapped.js` | Pure Spending Wrapped stats. `window.ExpenseWrapped` |
| `icon-system.js` | Icons, `escHtml`, `safeColor` |
| `sw.js` | Network-first shell. `CACHE_VERSION` / `ASSET_V` |
| `scripts/*-test.mjs` | Behavior tests. `scripts/*-screenshots.mjs` are QA captures |

Storage keys (do not rename): `expenseLogger.entries.v1`, `categories.v1`, `budgets.v1`, `recurring.v1`, `ui.v1`, `pin.v1` (cleared on boot, not exported), `importRules.v1`, `importSettings.v1`, `meta.v1`, `accounts.v1`, `transferPairs.v1`, `transferUnlink.v1`, `importAccountPrefs.v1`, `transferPatterns.v1`, `forecastOverrides.v1`, `forecastCountedOneOffs.v1`. Receipts live in IndexedDB database `expenseLogger`, store `receipts`. Backup documents use `backupFormat: 2` (`BACKUP_FORMAT_LEGACY` is 1).

Default accounts are hard-coded: `acct-checking` (Checking) and `acct-chase` (Chase card). The user can add more bank or credit-card accounts at import time. They cannot rename or delete an account.

Shipped arc, from merged PRs #1–#28: editable categories and budgets, recurring monthly items, CSV/Excel import with review and dedupe, reports and activity ranges, backup/restore, icons and Spending Wrapped, account tags and transfer pairs, checking forecast (DST-safe), Chase balance owed, edit-flow QoL (bulk recategorize, import review, forecast edit, transfer type, CSV balance offer), then 1.9.1 HTML-escaping and passcode removal.

## Conventions every step must follow

**Version-bump set** (include in every step’s diff):

- `app.js` — `APP_VERSION`
- `sw.js` — `CACHE_VERSION` (`expense-logger-vX.Y.Z`) and `ASSET_V`
- `index.html` — every `?v=` query (`styles.css`, `icon-animations.css`, `icon-system.js`, `forecast.js`, `wrapped.js`, `app.js`)
- `styles.css` — first-line comment (`Expense Logger X.Y.Z`)
- `scripts/sw-upgrade-test.mjs` — header comment, expected version strings, and `UPGRADE_FROM_REF`
- `scripts/splash-boot-test.mjs` — assertions that look for the version string
- `scripts/qol-190-test.mjs` and `scripts/chase-balance-test.mjs` — `APP_VERSION` equality asserts

`UPGRADE_FROM_REF` must be the commit on `main` that contains the **previous** version (today that is `a52bdc8` for 1.9.1, then whatever merge commit introduced the prior step). Do not point it at an unpushed SHA. The upgrade test must still prove one existing `expenseLogger.entries.v1` row survives the service-worker swap.

**PR title:** `Release X.Y.Z: <short user-facing phrase>`

**PR body:** what changed, root cause if it is a fix, files, tests run, and a note that saved keys were not renamed. Match the tone of #22–#28.

**Data rules:**

- A migration may add fields or fill them only when the new value cannot change checking or card balances for rows already saved. If a backfill would change `projectedStartingBalance` or `computeCardBalanceOwed`, do not backfill; gate the new behavior on a new optional field.
- Money tests use explicit amounts and `assert.strictEqual` on cents (the code rounds with `Math.round(n * 100) / 100`). Include a zero, a negative balance or credit, and one multi-row case.
- `saveEntries()` already returns false and toasts when `localStorage` throws. Callers that added rows must honor that return value.
- Destructive confirms must not rely on `window.confirm` or `window.prompt`. Those were called out in `DEEPSEEK-NOTES.md` as unreliable in iOS standalone, and PR #27 still uses `prompt()` for extra import categories. Reuse the in-app discard card pattern from #24 (`#importReviewDiscardScrim`).

**Conflict note:** `app.js` is one file (~9.7k lines). Every step touches it for the version string, and most touch it for behavior. Rebase onto latest `main` before opening the PR. Do not stack unmerged branches.

**Out of scope for the whole queue:** cloud sync, bank login, passcode or encryption theater, renaming storage keys, rewriting the app in a framework, splitting `app.js` into a module graph (a later suggestion only, and only if the human asks).

---

## Step template

Each step below uses the same fields. “Version-bump set” means the file list in Conventions, in addition to the files named on the step.

---

## Phase 1 — Stop silent data loss

These steps protect data already on the phone. They do not add features.

### 1.9.2 — Corrupt storage is kept, not replaced with empty

- **Goal:** If `expenseLogger.entries.v1`, `categories.v1`, or `accounts.v1` is non-empty and not valid JSON (or not the expected array), boot shows the existing Home error and refuses every save of that key. The raw string stays in `localStorage`.
- **Why:** `loadEntries` (`app.js`) returns `[]` on parse failure. The next successful `saveEntries()` would replace the user’s log with an empty array. Same pattern exists for categories and accounts.
- **Found in:** `loadEntries`, `loadCategories`, `loadAccounts`, and the empty `catch` on most `save*` helpers.
- **Files:** `app.js` (load/save guards, boot error copy). Reuse `#homeBootError`. Version-bump set. New `scripts/storage-guard-test.mjs`.
- **Depends on:** none.
- **Acceptance:**
  - Seed entries key as `{not:json`. After load, `localStorage` still holds that exact string. Adding an expense does not write `[]`.
  - Valid JSON still loads and a normal save still persists.
  - A corrupt categories key does not cause `saveCategories()` during `migrate()` to write `[]`.
  - Accounts key with a truncated string is unchanged; default Checking/Chase are not written over it.
- **Tests:** the three cases above, plus a round-trip of one valid entry `{id, amount: 12.34, categoryId, ts}`.
- **Size:** ~220 lines. **Conflict:** high on boot/`migrate` once later steps edit `migrate`. Land this first.
- **Scrutiny:** data loss.

### 1.9.3 — Failed import save rolls the batch back

- **Goal:** `commitImport` copies `entries` (and any account balance it is about to change) before mutating. If `saveEntries()` or `saveAccounts()` returns false or throws, restore the copies, leave the review sheet open, and toast that nothing was saved.
- **Why:** `commitImport` pushes rows, may set `currentBalance` / `balanceAsOf`, then calls `saveEntries()` and ignores the result. The toast still says “Imported N new”.
- **Found in:** `commitImport`, `saveEntries`, `saveAccounts` (`saveAccounts` swallows errors).
- **Files:** `app.js`. Version-bump set. Extend `scripts/import-test.mjs` or add `scripts/import-save-rollback-test.mjs`.
- **Depends on:** 1.9.2 (save helpers grow a reliable failure signal).
- **Acceptance:**
  - With storage forced to throw, a one-row import leaves the previous entry list and checking balance unchanged (example: balance `$2,000.00` as of `2026-10-01`, import row `$19.99` expense, both still the old values).
  - A normal import of `test/fixtures/sample-bank-checking.csv` still adds rows and still dedupes on a second import.
- **Tests:** failure path with explicit before/after amounts; existing `scripts/import-test.mjs` still passes.
- **Size:** ~200 lines. **Conflict:** medium (`commitImport` is also touched by 1.9.9 and 1.9.12).
- **Scrutiny:** data loss, import, balances.

### 1.9.4 — Spending Wrapped uses the same spending test as Home

- **Goal:** `wrapped.js` `entryCountsAsSpending` returns false for `isDeposit` entries, matching `app.js`.
- **Why:** Home excludes deposits. Wrapped does not. A paycheck (`isDeposit: true`, not a transfer) is counted as spending in the recap and not on Home.
- **Found in:** `wrapped.js` `entryCountsAsSpending` (no `isDeposit` check). `scripts/wrapped-test.mjs` only covers `countAsSpending: false`.
- **Files:** `wrapped.js`. Version-bump set. `scripts/wrapped-test.mjs`.
- **Depends on:** none for code; land after 1.9.2 so the version pin is linear.
- **Acceptance:** Fixture month: paycheck deposit `$3,200.00` (`isDeposit: true`, category `income`), groceries `$42.10`, transfer `$500.00` (`isTransfer: true`). Wrapped month total is `42.10`. `entryCountsAsSpending` is false for the deposit and the transfer, true for groceries. A `$0` deposit stays out.
- **Tests:** those asserts in `wrapped-test.mjs`. Do not change Home math in this step.
- **Size:** ~80 lines. **Conflict:** low (almost only `wrapped.js` plus version files).
- **Scrutiny:** money math.

### 1.9.5 — New recurring items use the date the user picked

- **Goal:** `addEntry` sets `recurringItems[].dayOfMonth` from the entry timestamp’s local calendar day, not from `new Date().getDate()`. Existing `recurring.v1` rows are left as stored.
- **Why:** The checkbox stores today’s day even when the sheet date is different (`addEntry` around the recurring block). A bill entered for the 3rd starts repeating on whatever day the phone happens to be.
- **Found in:** `addEntry` (`dayOfMonth: new Date().getDate()`).
- **Files:** `app.js`. Version-bump set. New `scripts/recurring-day-test.mjs` (Playwright, call the add path or a tiny test hook on `ExpenseLoggerTest` if the click path is too brittle — exporting a pure helper is fine).
- **Depends on:** 1.9.2.
- **Acceptance:**
  - Add `$80.00` dated `2026-11-03` with recurring on, while “today” in the test is `2026-10-24`. Saved item’s `dayOfMonth` is `3`. The entry `ts` is 3 Nov 2026 local.
  - An already-stored recurring item with `dayOfMonth: 24` is unchanged after boot.
- **Tests:** both cases. No forecast assertion in this step.
- **Size:** ~150 lines. **Conflict:** low-medium (`addEntry`).
- **Scrutiny:** money math (it changes when future auto-entries appear). No backfill.

### 1.9.6 — Manual recurring is not charged twice in the forecast

- **Goal:** `buildScheduledEvents` skips a manual `recurringItems` occurrence in a cycle where a ledger row with that `recurringId` already exists. It still projects later months. It does not assign `accountId` onto old rows.
- **Why:** `processRecurring` inserts a row with **no** `accountId`. `paymentPostedInCycle` only sees rows on the checking account, and it matches merchant text and amount, not `recurringId`. The forecast keeps subtracting the bill every month after Home has already recorded it. Old rows must not gain `accountId`, because `projectedStartingBalance` would then change checking.
- **Found in:** `forecast.js` `buildScheduledEvents` (the `input.recurringItems` loop) and `paymentPostedInCycle`. `app.js` `processRecurring`.
- **Files:** `forecast.js`, `scripts/forecast-test.mjs`. Version-bump set. Do not edit `processRecurring` here.
- **Depends on:** 1.9.5 (so new items have a stable day; the skip logic must not depend on that, but the tests should use a fixed day).
- **Acceptance:** Checking anchor `$1,000.00` on `2026-10-01`. Recurring item `$50.00`, `dayOfMonth` 15, note `Gym`. Ledger row in October with that `recurringId`, amount `50`, **no** `accountId`. As of `2026-10-20`:
  - `projectedStartingBalance` is still `1000.00` (the row is not on checking).
  - October forecast events do not include another `$50` gym outflow.
  - November still includes one `$50` gym outflow.
  - A second recurring item with no ledger row still appears in October.
- **Tests:** those three amounts in `forecast-test.mjs`. Existing Chase owed asserts (`1284.17`, `-70`) stay green.
- **Size:** ~180 lines. **Conflict:** medium (`forecast.js` schedule builder; later 1.12.x and 1.11.3 touch it).
- **Scrutiny:** money math, balances.

---

## Phase 2 — Import and export tell the truth

### 1.9.7 — CSV export total is spending, and new files round-trip type

- **Goal:** The `TOTAL` row sums `entrySpendingAmount` only. New exports add `Account` and `Type` (`expense`, `income`, `transfer`) and the account id. Import of a file that has `Type` sets `isDeposit` / `isTransfer` / `accountId` from those columns. Files **without** `Type` keep today’s behavior.
- **Why:** `exportCSV` adds every `amount`, including deposits and transfers, then writes a `TOTAL` row. Re-import uses the app-export layout (Date, Time, Category, Amount) and treats every positive amount as spending. PR #1 already special-cased the TOTAL row so it is not a transaction; the total itself is still the wrong number.
- **Found in:** `exportCSV`, `detectImportLayout`, `rowsFromTable` app-export branch.
- **Files:** `app.js`. Version-bump set. `scripts/import-test.mjs`. A small fixture under `test/fixtures/` for the new header. Do not change `sample-app-export.csv` expectations except to assert old files still import as spending.
- **Depends on:** 1.9.3 (import commit path).
- **Acceptance:**
  - Rows: expense `$10.00`, deposit `$100.00`, transfer `$40.00`. Exported TOTAL is `10.00`.
  - Re-import of that export: one expense `$10.00` that counts as spending, one deposit `$100.00` that does not, one transfer `$40.00` that does not. Second import adds zero rows.
  - Old app-export fixture without `Type` still imports its spending rows and still skips TOTAL.
- **Tests:** explicit totals above in `import-test.mjs`.
- **Size:** ~300 lines. **Conflict:** medium-high (import parser; 1.9.12–1.9.15 also edit it).
- **Scrutiny:** import, money math.

### 1.9.8 — Escape import-rule labels

- **Goal:** Category names in the Settings import-rule list go through `escHtml`. Rule ids in `data-del-rule` stay escaped.
- **Why:** PR #28 escaped category names in budgets, Settings categories, and recurring notes. `renderImportRulesList` still concatenates `getCat(...).name` into HTML.
- **Found in:** `renderImportRulesList`.
- **Files:** `app.js`, `scripts/import-test.mjs` or a tiny DOM test. Version-bump set.
- **Depends on:** none functionally; sequence after 1.9.7.
- **Acceptance:** A rule whose category name is `<img src=x onerror=alert(1)>` renders as text. The delete button still removes that rule and no other.
- **Tests:** one DOM assert. No math changes.
- **Size:** ~80 lines. **Conflict:** low.
- **Scrutiny:** privacy (imported text must not run as HTML). Same class of bug as #28.

### 1.9.9 — Statement balance offer updates the account the user picked

- **Goal:** When the user accepts the balance offer, write `currentBalance` and `balanceAsOf` on the import’s `accountId` if that account is `type: 'bank'`. Keep today’s date choice (`extractCheckingBalanceOffer`: latest posted balance). Do not write the offer onto a credit card.
- **Why:** `commitImport` only applies the offer when `accountId === 'acct-checking'`. A second bank account can be selected in the account sheet (1.5.0) and the offer is ignored. The offer was added in #27 for checking CSVs.
- **Found in:** `commitImport` balance-offer block; `extractCheckingBalanceOffer`.
- **Files:** `app.js`. Version-bump set. Extend `scripts/qol-190-test.mjs` or `import-test.mjs`.
- **Depends on:** 1.9.3.
- **Acceptance:**
  - Checking id `acct-checking`, offer `$2,378.42` on `2026-10-16`, user confirms: stored balance `2378.42`, as-of `2026-10-16`. Forecast projection still follows `projectedStartingBalance` (do not change the formula).
  - Same file assigned to a second bank `acct-savings`: that account gets `2378.42`, `acct-checking` is unchanged.
  - Offer assigned to `acct-chase` is not written.
  - Declining the offer writes neither account.
- **Tests:** the four cases with those amounts.
- **Size:** ~200 lines. **Conflict:** medium (`commitImport`).
- **Scrutiny:** balances, import.

### 1.9.10 — Card refunds reduce what you owe and are not spending

- **Goal:** A Chase-style card row with type Return/Refund and a negative amount becomes a saved entry on the card account: positive `amount`, `isDeposit: true` (or a dedicated `isRefund: true` if deposit would confuse the activity subtitle — pick one and document it in the PR). It is not spending. `entryCardOwedDelta` reduces owed by that amount. Re-import dedupes it. Pending rows stay skipped.
- **Why:** `rowsFromTable` pushes card returns as `status: 'credit'` and `commitImport` only increments `skippedCredit`. The user’s owed balance stays high by the refund amount. Card owed math already treats card `isDeposit` as a reduction (`forecast.js` `entryCardOwedDelta`).
- **Found in:** card branch of `rowsFromTable`; `commitImport` credit skip; `computeCardBalanceOwed`.
- **Files:** `app.js`, `scripts/import-test.mjs`, `scripts/chase-balance-test.mjs`. Version-bump set. Do not change the `$1,284.17` fixture results.
- **Depends on:** 1.9.4 (so Wrapped will not count the new deposit rows) and 1.9.3.
- **Acceptance:**
  - Anchor owed `$100.00` on `2026-10-01`. Posted return of `$25.00` on `2026-10-05` on `acct-chase`. `computeCardBalanceOwed` is `75.00`. Checking projection unchanged.
  - A `$25.00` purchase the same day still raises owed (purchase `+25`, refund `-25` nets correctly from a `$100` anchor → `100.00` if both exist).
  - Second import of the same return adds zero entries.
  - Home month total does not include the `$25` refund.
  - Negative owed still works (existing `-70` test).
- **Tests:** new cases in `chase-balance-test.mjs` and `import-test.mjs`.
- **Size:** ~280 lines. **Conflict:** medium (card import branch; 1.11.2 also touches owed UI, not this parser if this lands first).
- **Scrutiny:** money math, balances, import.

### 1.9.11 — Import review can pick any category without `prompt()`

- **Goal:** Replace `window.prompt('Category id', ...)` with an in-sheet list of every category (same chips, wrapping). Choosing one still runs the existing “apply to similar” prompt.
- **Why:** PR #27 shipped the review screen and noted that categories past the first five use `prompt()`, which is unreliable in standalone mode (`DEEPSEEK-NOTES.md`).
- **Found in:** `renderImportReview` prompt call.
- **Files:** `app.js`, `index.html`, `styles.css` (only the extra picker). Version-bump set. `scripts/qol-190-test.mjs`.
- **Depends on:** 1.9.8 (escaping). Keep 1.9.7’s parser untouched if possible.
- **Acceptance:** With 7 categories, the 7th is tappable and sets `categoryId` on that row. Similar-row apply still changes only `Other` rows with the same merchant key. Cancel leaves the row’s category. No `prompt` call remains under `app.js`.
- **Tests:** extend the Starbucks apply-to-similar case to choose a category that is not in the first five.
- **Size:** ~250 lines. **Conflict:** medium (`renderImportReview`, styles).
- **Scrutiny:** import (category writes become rules). No balance writes.

---

## Phase 3 — Backup actually contains the photos

Format 2 backups snapshot `localStorage` only (`buildBackupDocument`). Receipt photos are IndexedDB. The older “Export JSON backup” path (`exportJSON`) includes data-URL receipts; “Back up data” does not. Restoring onto a new phone drops photos. Format 2 files must keep restoring.

### 1.10.0 — Backup file includes receipt data URLs

- **Goal:** Bump `BACKUP_FORMAT` to 3. The document gains `receipts: { [entryId]: dataURL }` built from IndexedDB the same way `exportJSON` does. Format 2 files (no `receipts` field) still pass `validateBackupDocument`. Sharing still uses the existing share/download helper. No upload endpoint.
- **Why:** Found gap between `runBackupExport` / `buildBackupDocument` and `exportJSON`.
- **Files:** `app.js` (`BACKUP_FORMAT`, `buildBackupDocument`, `validateBackupDocument`). Version-bump set. `scripts/backup-test.mjs`.
- **Depends on:** 1.9.2 (do not write empty storage on failure).
- **Acceptance:**
  - A backup of one entry with a small `data:image/png;base64,...` receipt contains that string under `receipts[<id>]` and `backupFormat: 3`.
  - A format-2 fixture without `receipts` still validates and still restores entries.
  - A backup with zero receipts is `receipts: {}` and still validates.
- **Tests:** `backup-test.mjs` with a 1×1 PNG data URL. Assert the file never contains a network URL the app would fetch.
- **Size:** ~220 lines. **Conflict:** medium (`buildBackupDocument`, also touched conceptually by 1.10.1).
- **Scrutiny:** data loss, privacy (photos now leave the device only when the user invokes the same share sheet they already use).

### 1.10.1 — Restore writes receipts and does not delete ones the file omits

- **Goal:** Format 3 restore writes each `receipts` entry to IndexedDB and sets `hasReceipt` on that entry. If the field is absent (format 2), leave IndexedDB alone. Restoring does not call `idbClear`.
- **Why:** A naive restore that cleared photos would destroy pictures when the user loads an older file.
- **Files:** `app.js` `commitBackupRestore` and the receipt helpers. Version-bump set. `scripts/backup-test.mjs`.
- **Depends on:** 1.10.0.
- **Acceptance:**
  - Format 3 with receipt for entry `e1` restores the data URL and `hasReceipt: true`.
  - Format 2 restore while `e1` already has a photo leaves that photo in place.
  - Undo of a format 3 restore (existing `pendingRestoreUndo` path) puts the previous localStorage snapshot back. Receipt undo: store the previous data URL and write it back on undo; if there was none, delete only the ids that this restore added.
  - Entry amounts in the backup are unchanged by the receipt write (example entry `$12.34` still `$12.34`).
- **Tests:** those cases in `backup-test.mjs`.
- **Size:** ~280 lines. **Conflict:** medium (restore path).
- **Scrutiny:** data loss, privacy.

### 1.10.2 — “Import JSON backup” recognizes a format 2/3 file

- **Goal:** If the picked JSON has `backupFormat` and `storage`, open the existing restore confirm sheet instead of `importJSON`’s merge. `importJSON` stays for the legacy `{entries, categories, budgets, recurring, receipts}` shape, and it dedupes recurring items by `id` instead of appending copies.
- **Why:** Settings has both “Restore from backup” and “Import JSON backup”. A format-2 file has no top-level `entries`, so `importJSON` reports a useless import and can duplicate `recurring` rows when the legacy shape is used twice.
- **Found in:** `importJSON`, the JSON file input handler, Settings copy in `index.html`.
- **Files:** `app.js`, `index.html` (button subtitle only if needed). Version-bump set. `scripts/backup-test.mjs`.
- **Depends on:** 1.10.1.
- **Acceptance:**
  - Feeding a format-3 document to the JSON input shows the restore summary (entry count) and does not merge until confirm.
  - Importing the same legacy recurring id twice results in one item.
  - Legacy merge still adds a new entry id and skips an existing id (current behavior, with amounts asserted).
- **Tests:** backup-test cases. No change to checking math.
- **Size:** ~200 lines. **Conflict:** low-medium.
- **Scrutiny:** data loss, import.

---

## Phase 4 — Accounts beyond a single Chase card

1.5.0 lets the user add accounts. 1.8.0’s owed UI still assumes one Chase card: `getCardBalanceSnapshot` uses `getChaseAccount()`, `buildForecastPayload` passes `chaseId: 'acct-chase'`, and every credit-card row opens the Chase sheet and shows the Chase dollars (`renderSettingsAccounts`).

### 1.11.0 — Rename an account without changing its id

- **Goal:** Settings row can rename `name` (max 30 characters). `id` stays. Forecast and pairs keep working because they key off id.
- **Why:** `createAccountRecord` never offers a rename. A typo at import time is permanent.
- **Found in:** `renderSettingsAccounts`, `createAccountRecord`. There is no delete-account function.
- **Files:** `app.js`, `index.html`, `styles.css` for a small rename field. Version-bump set. Extend `scripts/accounts-transfer-test.mjs`.
- **Depends on:** 1.9.2.
- **Acceptance:** Rename `acct-chase` to `Freedom`. Stored id is still `acct-chase`. A paired transfer still pairs. Checking balance projection for `$1,234.56` is unchanged. Empty name is rejected and the old name remains.
- **Tests:** accounts test with those asserts.
- **Size:** ~200 lines. **Conflict:** medium (settings account renderer; 1.11.2 replaces part of it — land rename first).
- **Scrutiny:** none on math if id is unchanged. UI-only writes to `name`.

### 1.11.1 — Each credit card has its own owed anchor

- **Goal:** The owed snapshot and the Chase sheet are per `account.id`. A second card does not display the first card’s dollars and does not open the first card’s editor. Copy says the account’s name, not hard-coded “Chase”, except the default account’s stored name is still “Chase card”.
- **Why:** Found in `getCardBalanceSnapshot`, `buildForecastPayload` (`chaseId: DEFAULT_ACCOUNT_CHASE`), `renderSettingsAccounts` (one `chaseSnap` for every card, aria-label “Chase card”).
- **Files:** `app.js`, `index.html` (sheet titles that say Chase — use the account name at render time), `styles.css` only if a shared class is misnamed. Version-bump set. `scripts/chase-balance-test.mjs`.
- **Depends on:** 1.10.2 can be in parallel in theory; in practice land after it so version pins stay linear. Code dependency: 1.9.10 so refunds already reduce owed for whichever card id is passed.
- **Acceptance:**
  - Existing fixture: Chase anchor path still owes `$1,284.17`. Forecast card-payment amount for that fixture stays `$1,284.17`. Negative `-70` stays.
  - Second card `acct-amex` anchor `$400.00` on `2026-10-01`, purchase `$15.25` on `2026-10-03`: Amex owed `415.25`. Chase owed unchanged.
  - Settings shows `415.25` on Amex and the Chase figure on Chase, not the same number on both.
  - `buildForecastPayload` passes the Chase id when the Chase account exists, and does not apply Amex owed to the Chase payment schedule.
- **Tests:** add the Amex case next to the existing `1284.17` asserts. Do not edit the formula in `computeCardBalanceOwed` unless a test proves a bug.
- **Size:** ~350 lines. **Conflict:** high (`app.js` card sheet and forecast payload; 1.11.3 continues from here).
- **Scrutiny:** balances, money math.

### 1.11.2 — Forecast card payment uses the paired card’s name and id

- **Goal:** `detectCardPaymentSchedule` / the owed fallback schedule use the credit-card account that is actually paired, and the label is that account’s `name`. Item keys stay stable for the default Chase account (`card-payment|chase`) so existing overrides do not detach. A second card gets `card-payment|<id>` and does not steal Chase overrides.
- **Why:** `forecast.js` labels the schedule `Chase card payment` and uses item key `card-payment|chase` even when the paired card is not Chase. `estimateCardPayment` takes `chaseId`.
- **Found in:** `detectCardPaymentSchedule`, `estimateCardPayment`, `applyBalanceOwedToCardSchedule`.
- **Files:** `forecast.js`, `app.js` (pass the account record into the payload), `scripts/forecast-test.mjs`, `scripts/chase-balance-test.mjs`. Version-bump set.
- **Depends on:** 1.11.1.
- **Acceptance:**
  - Chase fixture payment amount remains `1284.17` and the override key `card-payment|chase` still applies an amount override (use `$10.00` off the fixture in a dedicated test, not by editing the fixture).
  - Amex-only pairing: schedule label equals the account name, amount equals that card’s owed anchor (`$40.00` test), and a Chase override object does not change the Amex amount.
- **Tests:** both cases. DST tests (`scripts/forecast-dst-owner-test.mjs`) still pass.
- **Size:** ~300 lines. **Conflict:** high (`forecast.js`).
- **Scrutiny:** money math, balances.

### 1.11.3 — Other bank accounts roll forward on their own ledger

- **Goal:** For every `type: 'bank'` account that has `currentBalance` and `balanceAsOf`, Settings and the balance sheet show **today’s** balance using the same sign rule as `entryCheckingDelta` (deposit adds, other rows subtract, only that `accountId`, only days after as-of through today). The Home “Money lasts until” card and `runForecast` stay on `getCheckingAccount()` only.
- **Why:** Every bank row has a Balance button and the sheet says later transactions adjust it (`openBalanceSheet`). Only the checking id is passed into `projectedStartingBalance`. A savings balance the user types never moves. `test/fixtures/sample-bank-savings-deposit.csv` exists because savings deposits were a dedupe case (#20), not a balance case.
- **Files:** `forecast.js` (generalize the existing function; keep `projectedStartingBalance` as a wrapper so old tests keep their name), `app.js` settings sublabel. Version-bump set. `scripts/forecast-test.mjs`, `scripts/accounts-transfer-test.mjs`.
- **Depends on:** 1.11.0 (stable ids). Do not start 1.11.4 before this, because copy depends on the real behavior.
- **Acceptance:**
  - Checking `$1,000.00` as of `2026-10-01`, debit `$10.00` on `2026-10-02`, deposit `$5.00` on `2026-10-03`, future debit `$80.00` on `2026-10-30`, “today” `2026-10-20`: projected checking is `995.00`. The `$80` is excluded.
  - Savings `$500.00` as of `2026-10-01`, savings deposit `$25.00` on `2026-10-04`: savings today is `525.00`. Checking stays `995.00`.
  - Unpaired transfer debit on checking of `$12.00` still reduces checking (1.7.3 rule). It does not also reduce savings.
  - Home forecast `startingBalance` equals the checking projection, not the sum of bank accounts.
- **Tests:** the numbers above in `forecast-test.mjs`.
- **Size:** ~320 lines. **Conflict:** high (forecast balance function).
- **Scrutiny:** balances, money math.

### 1.11.4 — Balance sheet copy matches the account that actually rolls forward

- **Goal:** The footnote that says transactions adjust the balance is shown for bank accounts only, and it names that account. Credit cards keep the owed explanation. No math change.
- **Why:** After 1.11.3 the footnote is true for every bank; before this step it is easy to leave the checking-only sentence on a card. This step is the copy cleanup once 1.11.3 has landed. If 1.11.3 has not landed, do not claim savings adjusts.
- **Files:** `app.js` `openBalanceSheet`, `renderSettingsAccounts`. Version-bump set. One Playwright assert in `scripts/accounts-transfer-test.mjs` or `forecast-balance-save-test.mjs`.
- **Depends on:** 1.11.3.
- **Acceptance:** Checking footnote contains “Checking” and “adjust”. Savings footnote contains the savings name. Chase owed sheet does not say the checking sentence. Amounts from 1.11.3’s fixture still display `995.00` and `525.00`.
- **Tests:** text asserts plus those two amounts.
- **Size:** ~120 lines. **Conflict:** medium (same renderer as 1.11.1).
- **Scrutiny:** balances (display only, but reviewers should confirm no write path changed).

---

## Phase 5 — Recurring and forecast the user can correct

### 1.12.0 — Edit or pause a manual recurring item

- **Goal:** Settings → Recurring can change amount, day of month (1–28, clamp 29–31 the way `processRecurring` already clamps), note, and account, or pause. Paused items do not generate a ledger row and are not forecast. Existing generated rows stay.
- **Why:** The list is delete-only (`renderRecurringList`). Forecast already supports weekly and biweekly **detected** schedules; manual items are monthly only. This step does not add weekly manual items.
- **Found in:** `renderRecurringList`, `processRecurring`, forecast recurring loop (1.9.6).
- **Files:** `app.js`, `index.html`, `styles.css`, `forecast.js` (honor `paused: true`). Version-bump set. `scripts/recurring-day-test.mjs`, `scripts/forecast-test.mjs`.
- **Depends on:** 1.9.5 and 1.9.6.
- **Acceptance:**
  - Item `$50.00` day `15` edited to `$55.00` day `2`. Stored values match. Previously generated October row stays `$50.00`.
  - Paused item does not add a November row when the test clock is 20 Nov, and `runForecast` has no event with that `recurringId`.
  - Unpaused item still projects one `$55.00` event in a month with no ledger row.
- **Tests:** those amounts. No migration of old rows’ `accountId`.
- **Size:** ~340 lines. **Conflict:** medium.
- **Scrutiny:** money math. `paused` is optional; missing means active.

### 1.12.1 — Manual recurring does not stack on a detected bill for the same merchant

- **Goal:** When expanding a manual recurring item, skip it if a detected checking schedule already has the same description key and an amount within 10% (the tolerance `entryMatchesScheduleRow` already uses).
- **Why:** Rent detected from the bank **and** a manual “Rent” recurring item both become outflows. That double-counts cash.
- **Found in:** `buildScheduledEvents` recurring loop vs `detectRecurringSchedules`.
- **Files:** `forecast.js`, `scripts/forecast-test.mjs`. Version-bump set.
- **Depends on:** 1.12.0 (pause flag exists; this is a separate rule).
- **Acceptance:** Detected monthly `RENT` `$1,200.00` from checking history, plus a manual recurring note `Rent` `$1,200.00`. Forecast month contains one `$1,200.00` rent outflow, not two. A manual `Gym` `$50.00` with no detected schedule still appears once.
- **Tests:** those two amounts. Chase `1284.17` unchanged.
- **Size:** ~160 lines. **Conflict:** medium (`forecast.js`).
- **Scrutiny:** money math.

### 1.12.2 — New manual recurring rows carry an account id

- **Goal:** `addEntry` and `processRecurring` set `accountId` on **newly created** rows to the add-sheet account, or to `getCheckingAccount().id` when the sheet account is empty. Do not rewrite old rows that lack `accountId`.
- **Why:** Without an account, the generated row hits Home spending and (after 1.9.6) suppresses the forecast, but it never moves checking. New bills the user marks recurring should move the account they picked.
- **Found in:** `processRecurring` entry object; `addEntry` recurring block.
- **Files:** `app.js`, `scripts/forecast-test.mjs`, `scripts/recurring-day-test.mjs`. Version-bump set.
- **Depends on:** 1.9.6 and 1.11.3 (projection helper per account).
- **Acceptance:**
  - New recurring expense `$20.00` on checking as of a date after the anchor: checking projection drops by `20.00`.
  - A pre-existing recurring ledger row with no `accountId` and amount `$20.00` does **not** change a `$1,000.00` checking projection.
  - Forecast still shows a single future occurrence (1.9.6), not a second one in the posted month.
- **Tests:** both projections asserted to the cent.
- **Size:** ~180 lines. **Conflict:** medium (`processRecurring`).
- **Scrutiny:** balances, money math. No backfill.

### 1.12.3 — Activity search matches amount, account, and bank text

- **Goal:** The Activity search box matches note, category name, `bankText`, account name, and a numeric amount (`12.50` matches `$12.50`).
- **Why:** `getFilteredEntries` only checks `note` and category name. Imported rows keep the raw line on `bankText` while `note` is the cleaned 80-character string (`cleanImportNote`).
- **Found in:** `getFilteredEntries`.
- **Files:** `app.js`. Version-bump set. `scripts/activity-subtitle-test.mjs` or `scripts/activity-range-test.mjs`.
- **Depends on:** 1.11.0 (account names can change; search should use the current name).
- **Acceptance:** Entry note `ACME`, `bankText` `ACME PAYROLL 998877`, account name `Checking`, amount `12.50`. Queries `998877`, `Checking`, and `12.50` each return that entry. Query `zzz` returns none. A `$12.50` transfer is still found by amount but the activity **total** still excludes it (assert total `0.00` when the only match is a transfer).
- **Tests:** those queries.
- **Size:** ~150 lines. **Conflict:** low.
- **Scrutiny:** money math only for the “total excludes transfer” assert.

---

## Phase 6 — Home, reports, and destructive UI

### 1.13.0 — Hero budget ignores the income category

- **Goal:** `getTotalBudgetLimit` and the per-category budget bars skip `categoryId === 'income'`. Other categories are unchanged. Stored `budgets.income` is left in place (not deleted).
- **Why:** Income is a default category (`ensureIncomeCategory`) used for paychecks, which are not spending. A budget saved on Income still adds into the Home “left of $X” bar via `getTotalBudgetLimit`.
- **Found in:** `getTotalBudgetLimit`, `renderBudgets`, `renderHeroBudget`.
- **Files:** `app.js`. Version-bump set. A small assert in an existing summary/report script, or `scripts/budget-total-test.mjs`.
- **Depends on:** 1.9.4 (deposits already excluded from spending; this step is the budget side).
- **Acceptance:** Budgets groceries `$400`, income `$9,000`. Hero limit is `400`. Spending `$100` groceries shows `$300.00` left, 25%. Income budget remains stored as `9000` so a later step can use it. Zero budgets → hero hidden (current behavior).
- **Tests:** those numbers.
- **Size:** ~120 lines. **Conflict:** low.
- **Scrutiny:** money math.

### 1.13.1 — In-app confirm for delete category, delete entry, delete receipt, clear all

- **Goal:** Replace `window.confirm` on `deleteCategory`, `deleteEntryFromEditor`, receipt delete, and Clear All with the opaque discard-card pattern. Clear All requires two taps inside the app (“Clear all data” then “Clear data”). Clear All removes every `expenseLogger.*` key except it may leave `expenseLogger.meta.v1` only if needed for nothing — **wipe all of them**, clear IndexedDB receipts, and reset in-memory state to defaults (default categories and the two default accounts).
- **Why:** `DEEPSEEK-NOTES.md` says standalone iOS can suppress `confirm()`. Clear All today (`clearAllBtn` handler) removes entries, categories, budgets, recurring, import rules, and import settings, then clears receipts. It leaves accounts, transfer pairs, forecast overrides, transfer patterns, one-offs, and meta. The user asked to clear all data and the app keeps balances and rules.
- **Found in:** `window.confirm` call sites; `clearAllBtn` handler.
- **Files:** `app.js`, `index.html`, `styles.css`. Version-bump set. `scripts/backup-test.mjs` or new `scripts/clear-all-test.mjs`.
- **Depends on:** 1.9.2 (must not “clear” by saving empty over a corrupt key — if a key is corrupt, remove the key rather than writing `[]` first). 1.10.1 (receipt clear should use the same idb helper).
- **Acceptance:**
  - Cancel on the first card leaves an entry of `$8.00` in place.
  - Confirming both cards: entries key absent, accounts key absent after reload re-seeds default Checking and Chase with **no** `currentBalance`, receipts store empty, forecast overrides gone.
  - A second entry is not required to prove the wipe; assert key absence.
- **Tests:** Playwright. Do not call `window.confirm`.
- **Size:** ~320 lines. **Conflict:** medium (sheets and styles shared with import discard).
- **Scrutiny:** data loss.

### 1.13.2 — Reports show income under spending, not inside it

- **Goal:** The report transaction list gains an Income group (deposits that are not transfers) with its own sum. The chart and “spent” figure stay spending-only, which is what `getSummaryData` already does. Do not add deposits into the chart.
- **Why:** After paycheck import, Reports never shows the deposit because `getSummaryData` filters with `entryCountsAsSpending`. The money is in Activity only if the user hunts for it. This is a display gap, not a math change to the chart.
- **Found in:** `renderReport`, `getSummaryData`.
- **Files:** `app.js`, `index.html` only if a container is required, `styles.css` for one group header. Version-bump set. `scripts/report-test.mjs`.
- **Depends on:** 1.9.4 and 1.9.10 (refunds/deposits must stay out of spent).
- **Acceptance:** Month with spending `$42.10` and paycheck `$3,200.00`: chart total `42.10`, income line `3200.00`, income not added into the chart. A transfer `$500` appears in neither sum.
- **Tests:** `report-test.mjs` with those amounts.
- **Size:** ~250 lines. **Conflict:** medium (`renderReport`).
- **Scrutiny:** money math (display splits).

### 1.13.3 — Pinch zoom works, and 200% text still wraps

- **Goal:** Remove `maximum-scale=1` and `user-scalable=no` from the viewport. At a 200% text zoom simulation (Playwright `emulateMedia` or a CSS zoom check the HIG script already approaches), tab labels and forecast row titles still wrap instead of clipping. Do not move the centered + button.
- **Why:** `index.html` locks zoom. PR #25 fixed 200% wrapping and said the centered “+” stays until the owner decides. This step finishes the zoom half of that HIG pass only.
- **Found in:** viewport meta; PR #25 body (“centered + remains as-is”).
- **Files:** `index.html`, `styles.css` only if a new overflow shows up. Version-bump set. `scripts/hig-regression-test.mjs`.
- **Depends on:** none functionally. Sequence here so it does not collide with 1.13.1’s CSS in the same week — rebase.
- **Acceptance:** Viewport content has no `user-scalable=no`. Existing HIG regression script passes. Forecast nav still has safe-area padding (do not regress #25).
- **Tests:** `hig-regression-test.mjs`. No money asserts.
- **Size:** ~80 lines unless a wrap regression appears; if the CSS fix exceeds ~150 lines, split. **Conflict:** low, except `styles.css` vs 1.13.1.
- **Scrutiny:** none.

### 1.13.4 — One `roundRect` for charts, one for the Wrapped canvas

- **Goal:** The two `function roundRect` declarations in `app.js` become two named functions. Chart drawing keeps the guard that returns when width or height is ≤ 0. The Wrapped share canvas keeps its own helper.
- **Why:** Both are declared in the same IIFE. The later one is the function that actually runs, so the chart guard is dead. Found by reading `app.js` (chart helper near `renderBudgets`, second helper just above `shareWrapped`).
- **Files:** `app.js`. Version-bump set. A unit-style assert is awkward here; add a comment-free code path and run `scripts/report-test.mjs` plus `scripts/wrapped-test.mjs` to prove nothing threw. If a canvas test can call the guarded helper via `ExpenseLoggerTest`, export it and assert it does not throw on `w = 0`.
- **Depends on:** none. Land after Wrapped tests from 1.9.4 exist.
- **Acceptance:** `rg "function roundRect"` shows two different names. Wrapped share still produces a blob in the existing test if one calls `drawWrappedToCanvas`. Zero-size chart helper returns without throwing.
- **Tests:** as above.
- **Size:** ~60 lines. **Conflict:** low.
- **Scrutiny:** none.

---

## Phase 7 — Hardening

### 1.14.0 — Service worker install survives one missing icon

- **Goal:** `precacheShell` precaches shell HTML/JS/CSS as now. A single icon SVG 404 does not reject the whole install. A failed **shell** file (`app.js`, `index.html`, `forecast.js`, `wrapped.js`, `styles.css`) still fails install.
- **Why:** `precacheUrl` throws, and `Promise.all` includes every icon from `icons.json`. One bad icon blocks a new service worker, which is how phones get stuck on an old build (the 1.6.2 splash notes are the same family of “update never finishes” bugs).
- **Found in:** `sw.js` `precacheShell`.
- **Files:** `sw.js`. Version-bump set. `scripts/sw-upgrade-test.mjs` (upgrade still works). Add a case in that file or `scripts/splash-boot-test.mjs` only if it can stub a 404 without a large harness; otherwise a focused comment in the test that shell failure still rejects is enough if a 404 stub is <80 lines.
- **Depends on:** version-bump discipline only.
- **Acceptance:** Upgrade test  previous → this version still preserves the `$12.50` entry. Precache logic treats icon failures as skippable (assert by reading the worker in a test that mocks `fetch` if cheap).
- **Tests:** `sw-upgrade-test.mjs` must pass.
- **Size:** ~120 lines. **Conflict:** low (`sw.js` is mostly the version constant outside this step).
- **Scrutiny:** none. Do not change cache keys’ meaning beyond the version string.

### 1.14.1 — Import review lists skipped rows

- **Goal:** The review sheet can show Pending, Credits (ones still skipped), and Unreadable in a read-only filter, with the existing `reason` string. This step does not import them. After 1.9.10, returns are no longer in Credits; any remaining credit reason still shows.
- **Why:** `commitImport` counts skips in a toast and the rows are hard to see. Users re-download the CSV because they think the app dropped a purchase.
- **Found in:** `importRowPassesFilter`, status values `pending` / `credit` / `unreadable`.
- **Files:** `app.js`, `styles.css` for a muted row. Version-bump set. `scripts/import-test.mjs`.
- **Depends on:** 1.9.10 and 1.9.11 (review UI).
- **Acceptance:** A fixture row with status Pending is visible under that filter and is absent from `entries` after commit. An unreadable row with a non-numeric amount is visible and not saved. A normal `$9.00` purchase still saves.
- **Tests:** import-test with those three rows.
- **Size:** ~220 lines. **Conflict:** medium (review renderer).
- **Scrutiny:** import (must not start saving skipped rows).

### 1.14.2 — Storage-full message before a large import commits

- **Goal:** Before `commitImport` mutates, estimate `JSON.stringify(entries)` growth. If `navigator.storage.estimate` is available and the estimate would leave less than 200 KB free, stop and tell the user to export a backup. If `estimate` is missing, keep 1.9.3’s rollback as the safety net.
- **Why:** iOS clears or caps origin storage. The app already calls `navigator.storage.persist()` and shows “may be cleared by iOS” (#5). It does not warn before a big CSV.
- **Found in:** `initPersistentStorage`, `commitImport`.
- **Files:** `app.js`. Version-bump set. `scripts/import-save-rollback-test.mjs`.
- **Depends on:** 1.9.3.
- **Acceptance:** A stubbed `estimate` of `{usage: 900, quota: 1000}` with a large pending batch does not change entry count or checking balance (`$2,000.00` stays `$2,000.00`). A stubbed large quota still imports one `$4.00` row.
- **Tests:** those two. No new network.
- **Size:** ~180 lines. **Conflict:** medium (`commitImport`).
- **Scrutiny:** data loss, import.

### 1.14.3 — Category delete moves expenses in one save

- **Goal:** `deleteCategory` already retargets entries to Other (or the first remaining category) and saves. Add a test, and show the in-app confirm from 1.13.1 with the count (“12 expenses will move to Other”). If Other is the category being deleted, pick the first remaining id and say its name. Do not drop entries.
- **Why:** The confirm text says expenses “will be moved” but there is no automated test. A bug here is silent recategorization.
- **Found in:** `deleteCategory`.
- **Files:** `app.js` (copy only if 1.13.1 already replaced `confirm`). Version-bump set. New asserts in `scripts/clear-all-test.mjs` or a category test.
- **Depends on:** 1.13.1.
- **Acceptance:** Two groceries expenses `$3.00` and `$4.00`. Delete Groceries. Both `categoryId`s equal `other`. Sum of amounts is still `7.00`. Entry ids unchanged. Cancel deletes nothing.
- **Tests:** those asserts.
- **Size:** ~150 lines. **Conflict:** low.
- **Scrutiny:** data loss (category ids on entries).

---

## Phase 8 — Suggestions

These are **not** in a PR body, issue, or TODO comment. Ship them only after the human accepts the open question. They are still sized as single PRs.

### 1.15.0 — Weekly manual recurring (suggestion)

- **Goal:** The recurring editor from 1.12.0 gains `monthly` (default) and `weekly`. Weekly stores `weekday` 0–6. `processRecurring` adds at most one row per ISO week. Forecast emits weekly events. Existing items without `frequency` stay monthly.
- **Why it is a suggestion:** Forecast detection already finds weekly merchants (`fitSchedule`). The manual model is monthly because the original brief said “the 1st of each month” (`DEEPSEEK-NOTES.md`). The repo never asks for weekly manual items.
- **Files:** `app.js`, `forecast.js`, `index.html`, tests. Version-bump set.
- **Depends on:** 1.12.0, 1.12.2.
- **Acceptance:** Weekly `$15.00` on Fridays. In a two-week window the forecast contains two `$15.00` events. A monthly item is unchanged. Old saved item without `frequency` still uses `dayOfMonth`.
- **Tests:** forecast-test with a fixed `nowMs`.
- **Size:** ~300 lines. **Conflict:** high (`forecast.js`, recurring editor).
- **Scrutiny:** money math.

### 1.15.1 — Split one expense across two categories (suggestion)

- **Goal:** An entry may gain `splits: [{categoryId, amount}]` whose amounts sum to `amount`. Spending totals use the splits. Entries without `splits` render as today. Backup format 3 already stores arbitrary entry JSON, so no format bump if the field is just on the entry.
- **Why it is a suggestion:** No split code, comment, or PR. Useful for a single Target receipt. Higher risk because every `byCat` loop must learn the field.
- **Files:** `app.js`, `wrapped.js`, `forecast.js` only if a split could be a checking debit (the cash amount stays the parent `amount`; category splits must not change `entryCheckingDelta`). Tests in report, wrapped, and forecast.
- **Depends on:** 1.9.4, 1.13.2, 1.11.3.
- **Acceptance:** Parent `$30.00` split `$20.00` groceries and `$10.00` dining. Category totals match. Checking delta is `-30.00` once, not `-60.00`. An unsplit `$5.00` entry still counts as `5.00` in its category. Reject a save when splits sum to `$29.99`.
- **Tests:** those numbers in three files. If the diff exceeds 400 lines, stop after the data model and Home totals, and put Reports/Wrapped in 1.15.2.
- **Size:** ~400 lines, split if needed. **Conflict:** high (every total).
- **Scrutiny:** money math, balances, migration (old entries have no `splits` and must total the same as before).

### 1.15.2 — Export only the Activity filter (suggestion)

- **Goal:** Activity overflow can export the current filtered rows to CSV using the 1.9.7 columns, without a TOTAL row that includes hidden rows. Settings “Export CSV” still exports everything.
- **Why it is a suggestion:** Export is global (`exportCSV`). Nobody filed “export this month”.
- **Files:** `app.js`, `index.html`. Version-bump set. `scripts/import-test.mjs` or activity test.
- **Depends on:** 1.9.7 and 1.12.3.
- **Acceptance:** Filter to one `$8.50` expense. Activity export has that row and TOTAL `8.50`. Full export still has the other `$3.00` row. Re-import of the small file does not duplicate the `$8.50` and does not delete the `$3.00`.
- **Tests:** those amounts.
- **Size:** ~200 lines. **Conflict:** low.
- **Scrutiny:** import (round-trip).

### 1.15.3 — Short maintainer map (suggestion)

- **Goal:** Add `docs/APP_MAP.md` (one page): files, storage keys, version-bump set, how to run `node scripts/forecast-test.mjs` and the Playwright scripts, and “do not rename keys”. No feature change and **no version bump** — this is the only step that does not ship an app version, so it does not touch `APP_VERSION`. If that is awkward for the queue, fold the page into the 1.14.0 PR instead and delete this step.
- **Why it is a suggestion:** The repo has no root README. This plan is the first `docs/` file.
- **Files:** `docs/APP_MAP.md` only.
- **Depends on:** none. Write it last so the key list matches shipped fields (`paused`, `backupFormat` 3, and so on).
- **Acceptance:** A newcomer can find `projectedStartingBalance` and the test command from that page. No JS diff.
- **Tests:** none.
- **Size:** ~120 lines. **Conflict:** none.
- **Scrutiny:** none.

---

## Dependency order

```text
1.9.2 storage guard
  ├─ 1.9.3 import rollback ── 1.9.7 CSV round-trip
  │                         ├─ 1.9.9 balance offer on chosen bank
  │                         └─ 1.14.2 storage-full warning
  ├─ 1.9.5 recurring day ── 1.9.6 forecast skip posted recurring
  │                         └─ 1.12.0 edit/pause ── 1.12.1 don't stack on detected
  │                                               └─ 1.12.2 new rows get accountId
  └─ 1.13.1 in-app delete / clear all ── 1.14.3 category delete test

1.9.4 Wrapped deposits ── 1.9.10 card refunds ── 1.11.1 per-card owed
                                              └─ 1.13.0 income budget
                                              └─ 1.13.2 report income group

1.9.8 escape rules ── 1.9.11 category picker (no prompt)
1.10.0 receipts in backup ── 1.10.1 restore receipts ── 1.10.2 JSON button routes to restore
1.11.0 rename ── 1.11.3 other-bank rollforward ── 1.11.4 footnote
1.11.1 ── 1.11.2 forecast card label/id
1.12.3 activity search (after rename)
1.13.3 pinch zoom (independent; rebase CSS)
1.13.4 roundRect rename (independent)
1.14.0 SW icon failure (independent)
1.14.1 skipped-row filter (after 1.9.10 and 1.9.11)

Suggestions 1.15.x only after the questions below are answered.
```

Merge the numbered releases in version order even when the code dependency is weak, so `UPGRADE_FROM_REF` is always the previous release.

## Risks

- **`app.js` conflicts.** Almost every step edits it. A rebased step that only updates the version string and misses a hunk will ship the wrong `APP_VERSION` or drop a fix. Reviewers should check the version-bump set first.
- **Forecast and card owed are easy to “fix” by changing a fixture.** The Chase path’s `$1,284.17` and `-$70` results are the regression net for 1.8.0. Steps 1.9.10, 1.11.1, and 1.11.2 must keep them.
- **Backfilling `accountId` onto old recurring rows would move checking balances.** Steps 1.9.6 and 1.12.2 forbid that on purpose.
- **Backup format 3 files get large** once receipt photos are embedded. The share sheet can fail on a huge file. 1.10.0 should still write the file; if a test shows a multi-megabyte payload, stop and ask before adding compression or stripping photos.
- **Clear All (1.13.1) is destructive.** The two-step in-app confirm is the mitigation. There is no recycle bin after the undo toast window.
- **iOS is not in this environment.** Playwright WebKit covers some bugs (splash, balance save). Standalone Home Screen quirks (keyboard, `confirm`, safe area) still need a phone pass on sheet-heavy steps (1.9.11, 1.12.0, 1.13.1).
- **Service-worker pins.** If `UPGRADE_FROM_REF` is wrong, the upgrade test fails closed. That is preferred to a green test that never loaded the old shell.
- **Two spending definitions.** `app.js`, `wrapped.js`, and `forecast.js` each decide what counts. 1.9.4 aligns Wrapped with Home for deposits. A later change to spending must update all three or explicitly say why forecast cash and spending totals differ (they should differ: transfers move cash and are not spending).

## Open questions for the human

1. **Second credit card.** Is per-card owed (1.11.1–1.11.2) something you want, or is Chase the only card that should show a balance? If Chase-only, skip 1.11.1 and 1.11.2 and instead hide the owed dollars on any card that is not `acct-chase`.
2. **Savings.** Should a non-checking bank show a rolled-forward balance (1.11.3), or should extra bank accounts stay tags with no balance? The Balance button currently implies they have one.
3. **Card refunds.** Confirm they should lower the amount you owe and stay out of spending (1.9.10). If you want them ignored, skip that step.
4. **Clear All.** Should it wipe accounts, forecast edits, and photos (1.13.1), or keep accounts and balances?
5. **Receipts in the backup file.** Are you willing for “Back up data” to embed photos (1.10.0)? They can be large, and the file leaves the phone when you share it.
6. **Centered + button.** PR #25 left it for you to decide. This plan does not move it. Say if you want a step that turns it into a normal tab.
7. **Suggestions (1.15.x).** Weekly manual recurring, split categories, and filtered CSV export are not from the repo. Say which to build.
8. **Manual recurring vs detected bills.** 1.12.1 drops the manual item when a detected schedule matches. If you would rather be asked each time, say so before that step.

## Recommended first batch

Merge these five before any feature work. They are small, they do not rename keys, and they stop the worst wrong numbers and silent overwrites.

| Order | Version | What the user gets |
| --- | --- | --- |
| 1 | **1.9.2** | A damaged save file is left untouched instead of being replaced with an empty log. |
| 2 | **1.9.3** | If the phone cannot store an import, the review stays open and balances stay put. |
| 3 | **1.9.4** | Spending Wrapped stops counting paychecks as spending. |
| 4 | **1.9.5** | A new recurring bill repeats on the day you entered, not “whatever day it is today”. |
| 5 | **1.9.6** | The forecast stops charging that recurring bill again in a month that already has it, without moving old checking math. |

After that batch, the next highest-value pair is **1.9.7** (CSV totals and round-trip) and **1.9.10** (card refunds lower the amount owed).
