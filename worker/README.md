# Expense Logger sync Worker

Cloudflare Worker + D1 for Plaid bank sync. Plan: issue #46. Sandbox and fake data only until Tri says otherwise.

Never commit secrets. Set them with `npx wrangler secret put <NAME>`:
`PLAID_CLIENT_ID`, `PLAID_SECRET`, `TOKEN_ENC_KEY` (base64 of 32 random bytes), `SETUP_CODE`, and (household mirror) `HOUSEHOLD_CODE`, a different code for the second phone. Existing deployments must re-run `schema.sql` (all `CREATE TABLE IF NOT EXISTS`) and set `HOUSEHOLD_CODE` before the new routes work.

## Household and agent routes (plan #66, docs/AGENT_BRIEF.md)

- `POST /household/pair` (HOUSEHOLD_CODE) gives a read-only viewer token. `POST /viewers/revoke` (writer) revokes all viewers.
- `POST /snapshot`, `GET /snapshots`, `GET /snapshot?id=` (writer); `GET /snapshot` newest (writer or viewer). Ciphertext only; last 5 kept.
- `POST /brief` (writer) stores `{briefs:{L0,L1}}`, rejecting forbidden field names. `GET /brief` (agent token) returns only its own level.
- `GET/POST /agents`, `POST /agents/revoke` (writer). An agent token is shown once; only its hash is stored. Agent tokens reach nothing but `GET /brief`.

Tests: `node worker/test/worker-household-test.mjs`.

Tests (Node 22+): `node worker/test/worker-auth-test.mjs` and `node worker/test/worker-sync-test.mjs`

## App side

- Settings → Bank sync pairs the phone (`POST /pair`) and stores `{workerUrl, deviceToken, pairedAt}` in `expenseLogger.sync.v1`. That key is device-only: it is never in a backup or export, and restore or Undo leave it in place (so a restore does not unpair; Disconnect does).
- `link.html` runs Plaid Link in Safari (and is the OAuth redirect page). The service worker never caches or intercepts it.

## API contract (what the app calls)

All responses are JSON. CORS allows only `https://nixcapital.github.io`. Device routes need `Authorization: Bearer <deviceToken>`.

| Route | Auth | Body / result |
| --- | --- | --- |
| `POST /pair` | none (setup code in body) | `{setupCode}` gives `{deviceToken}` |
| `POST /disconnect` | device | revokes this token |
| `POST /link/token` | `Authorization: Setup <code>` | gives `{linkToken}` (used by `link.html` in Safari). With `{itemId}` it returns an update-mode token to reconnect that Item (`404 unknown_item` if not linked) |
| `POST /link/exchange` | `Setup <code>` | `{public_token, institution, accountMap: {plaidAccountId: 'acct-checking' or 'acct-chase'}}` |
| `GET /pull` | device | syncs Plaid, returns the one unacknowledged batch (below) |
| `POST /ack` | device | `{batchId}`: deletes that batch. `409 stale_batch` if a newer batch exists, `200 deleted:false` if none |

`GET /pull` result:

```
{ batchId: string | null,            // null when there is nothing to deliver
  added:    [txn], modified: [txn],  // posted rows only (pending are dropped), mapped accounts only
  removed:  [{transaction_id, account_id}],
  accounts: [{itemId, account_id, appAccountId, mask, type, current, available, pendingTotal}],  // live balances from this sync
  needsReconnect: [itemId],          // Plaid ITEM_LOGIN_REQUIRED
  errors: [{itemId, code}] }         // short Plaid error codes, never raw bodies
txn = { transaction_id, account_id, amount, iso_currency_code, date, authorized_date,
        name, merchant_name, original_description, pending, pending_transaction_id,
        personal_finance_category: {primary, detailed} | null }
```

Rules the app can rely on: Plaid sign convention (positive = money out). Unacked rows are re-served until acked, merged with newer changes under a new `batchId` (a `removed` for a row the phone never received cancels the add). The app should `POST /ack` only after its own commit succeeded. The Worker keeps only encrypted tokens, cursors and the one unacked batch.
