# Agent brief and household mirror

Design for plan #66. Docs only. Other tasks (#69, #71, #72, #73) build against this file. All numbers below are fake.

## 1. Agent brief

A small JSON document the phone builds with `brief.js`. Agents get the brief and nothing else.

### Levels

| Field | L0 | L1 |
| --- | --- | --- |
| `schema`, `level`, `generatedAt` | yes | yes |
| `months[]`: `month`, `income`, `spend`, `savingsRate`, `byCategory{}` (totals) | yes | yes |
| `forecast`: `lowPointDate`, `lowPointAmount`, `runwayDays` | yes | yes |
| `balances`: `checking`, `chaseOwed` (rounded to nearest $100) | yes | yes |
| `upcomingBills[]`: `name`, `amount`, `dueDate` | no | yes |
| `topMerchants{}` per category (name and total, top 5) | no | yes |

Default: L0 for every agent, L1 only for agents Tri names (currently Claude).

### Never included

Account numbers or masks, Plaid ids, any token, `expenseLogger.sync.v1`, `bankText`, receipts or images, row-level transactions, and anything from client-intake. `scripts/brief-test.mjs` scans the serialized output for these.

### Example (L0, fake)

```json
{
  "schema": 1, "level": "L0", "generatedAt": "2026-11-02T03:00:00Z",
  "months": [{ "month": "2026-10", "income": 6200, "spend": 4875,
               "savingsRate": 0.21, "byCategory": { "Groceries": 640, "Rent": 1800 } }],
  "forecast": { "lowPointDate": "2026-11-18", "lowPointAmount": 900, "runwayDays": 41 },
  "balances": { "checking": 3100, "chaseOwed": 1200 }
}
```

### Tokens

- Each agent has its own read-only bearer token, tied to one level, revocable on its own.
- `GET /brief` returns the latest brief at or below the token's level. No other route accepts an agent token.
- Tokens live only in the agent's own settings, never in the repo or in chat.

## 2. Household mirror

- The phone stays the only writer.
- **Encryption.** The key is derived from a household passphrase (PBKDF2 or Argon-class KDF, per-household salt, AES-GCM). The passphrase and key never leave the devices. The server stores ciphertext only.
- **Contents.** A backup-format snapshot (`BACKUP_FORMAT` 2 compatible), without `expenseLogger.sync.v1` and without receipt images.
- **Upload.** When the app opens after a change, not in the background. The Worker keeps the last 5 snapshots.
- **Restore.** Settings gets "Restore from household copy" (needs the passphrase). Old backup formats 1 and 2 must still restore.
- **Second phone.** One "Join household" field, a separate setup code, a read-only token. It downloads the newest snapshot and shows every screen, including forecasts and Wrapped.
- **View mode.** Edit, import, bank sync and backup-restore controls are hidden, and writes to `expenseLogger.*` are blocked in code. A test enforces this.
- **Loss cases.** Lost passphrase means the server copy is unreadable; keep it in a password manager. Keep the manual backup export as the third copy.
