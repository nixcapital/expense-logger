# AGENTS.md

Shared rulebook for every AI agent working in this repo (Claude Code, Cursor agents, anything else). Humans: Tri owns the repo and is the only one who merges.

## What this is

Expense Logger is a personal expense tracker: a static PWA with no build step, no framework and no `package.json`. It is served from GitHub Pages (`https://nixcapital.github.io/expense-logger/`) and used on an iPhone via Add to Home Screen. The device is the source of truth.

| File | Role |
| --- | --- |
| `index.html` | Screens and sheets; assets carry a `?v=` cache-bust |
| `app.js` | UI, `localStorage`, IndexedDB receipts, import, backup/restore |
| `forecast.js` | Pure cash-flow math (also `module.exports` for Node tests) |
| `wrapped.js` | Pure Spending Wrapped stats |
| `icon-system.js` | Icons, `escHtml`, `safeColor` |
| `styles.css` | Dark-first iOS layout; header comment carries the version |
| `sw.js` | Service worker; `CACHE_VERSION` is the app version |
| `scripts/` | Node + Playwright tests (`*-test.mjs`) and screenshot scripts |
| `docs/LONG_HORIZON_PLAN.md` | Queue of small planned releases |

## Code rules

- Global scripts, not ES modules (the Node test scripts are the exception). No libraries, bundler, or `package.json` unless a task explicitly says so.
- Data is stored under `expenseLogger.*` keys. Never rename a key; migrate if a shape changes. Old backup formats (`BACKUP_FORMAT` 1 and 2) must still restore. New fields are optional.
- Passcode lock was removed on purpose. Do not bring it back.
- No server, analytics, or account sync.
- A user-visible release bumps the version everywhere it appears (`APP_VERSION` in `app.js`, `sw.js` `CACHE_VERSION` and `ASSET_V`, every `?v=` in `index.html`, header of `styles.css`, and the pinned version in `scripts/*-test.mjs`): patch for a fix, minor for a feature. Docs-only and workflow-only PRs do not bump it.
- Keep PRs small, ideally under 400 changed lines. One task per PR; don't widen scope.
- Tests run as `node scripts/<name>.mjs`. Add or update a test for any behavior change. Many scripts expect the repo at `/workspace` or `EL_ROOT`; set `EL_ROOT` if yours lives elsewhere. QA viewport is 428×926.

## Plan first

Tri's asks get a shared plan before anyone codes.

1. **Plan issue.** For each new ask from Tri, Claude opens an issue labeled `plan` with the ask in Tri's words and a draft approach.
2. **Ideas.** PA / Cursor adds its own ideas as comments on that issue. Claude does the same where it disagrees or sees gaps.
3. **Final plan.** Claude merges both into one plan in the issue body and splits it into task issues, each labeled `claude` or `cursor` and sized for one PR. Independent tasks are marked **parallel**; tasks that touch the same files or the version strings are marked **after #N**.
4. **Tri approves the split.** No task starts until Tri says yes on the plan issue or in chat. Small obvious fixes with an existing issue can skip this.

## Working together

Tasks live in GitHub issues. The label says who has it: `claude` or `cursor`. No label means unclaimed. Plan issues carry `plan` and are not tasks.

1. **Claim.** Before starting, put your label on the issue and comment "starting" with your branch name. Don't take an issue that already has the other agent's label. If two agents want the same issue, the one that labeled first keeps it.
2. **Branch per task.** `claude/<issue>-slug` or `cursor/<issue>-slug`, for example `cursor/12-csv-export-fix`. Never commit to `main`. Never push to the other agent's branch.
3. **Open a PR** from your branch using the PR template. Link the issue with `Closes #N`, say how you tested, and name the reviewer agent.
4. **Cross-review.** Claude reviews Cursor's PRs and Cursor reviews Claude's. Review for correctness, data safety, and the code rules above. Leave comments on the PR; don't push onto the author's branch without being asked.
5. **Hand off** by commenting on the issue with what's done, what's left, and the branch. Then swap the label.
6. **Only Tri merges.** Agents never merge, approve on Tri's behalf, or force-push shared history.
7. Parallel PRs touching version strings will conflict, so avoid two release PRs at once. Say in the issue if your task needs a version bump.

## Keep out of the repo

No bank data, statements, account numbers, client information, credentials, or real receipts. Fixtures in `test/fixtures` must be fake. If you find real data, stop and tell Tri.
