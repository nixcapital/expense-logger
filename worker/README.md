# Expense Logger sync Worker

Cloudflare Worker + D1 for Plaid bank sync. Plan: issue #46. Sandbox and fake data only until Tri says otherwise.

Never commit secrets. Set them with `npx wrangler secret put <NAME>`:
`PLAID_CLIENT_ID`, `PLAID_SECRET`, `TOKEN_ENC_KEY` (base64 of 32 random bytes), `SETUP_CODE`.

Routes so far: `POST /pair`, `POST /disconnect`, `POST /link/token`, `POST /link/exchange`, `GET /health`.
Sync, pull and ack come in the next PR (#49).

Test (Node 22+): `node worker/test/worker-auth-test.mjs`
