# AI Mail Hub (Cloudflare Worker)

Live: https://ai-mail-hub.livehqfield.workers.dev. Worker `ai-mail-hub` on account e68a968c46c9facc84cf06b0ec76b3f7. KV `AI_MAIL_HUB_KV` (b4177a174d4540d09b2daf2433a5f87c) is bound as `KV`.

## Layout
- `src/worker.js`: router, HTTPS redirect and security headers.
- `src/core.js`: crypto (AES-GCM for tokens and keys, SHA-256 key hashes, constant-time compare), Gmail API, label scoping, MIME building, sending, rate limit and log.
- `src/api.js`: MCP Streamable HTTP server (`POST /mcp/<key>`, `/mcp?key=`, or `Authorization: Bearer`), REST `/api/v1/*`, and `/openapi.json`.
- `src/aiweb.js`: per-AI web page `/ai/<ai>?key=`, plain-text `inbox.txt`, `sent.txt`, `search.txt?q=`, `msg/<id>.txt` and `help.txt`, plus form POST `/ai/<ai>/send` and `/ai/<ai>/reply` (HMAC CSRF token). GET never sends.
- `src/admin.js`: password login (session cookie `__Host-`, CSRF token, 10 failed tries per IP per 15 minutes), dashboard, key show/rotate/revoke, settings, Google OAuth connect/callback/disconnect, and send log.
- `test/run-tests.mjs`: 85 offline tests against a mocked KV and a mocked Google/Gmail API (`npm test`). No network and no real email.
- `scripts/make-deploy.mjs`: builds the Cloudflare API upload used through the Cloudflare MCP `execute` tool. `update` keeps existing secrets (`keep_bindings: secret_text`), and `first` sets them from `.secrets/`. The payload file is written chmod 600. Delete it after deploying.

## Secrets (never commit; `.secrets/` is chmod 700 and gitignored)
Worker secrets: `ADMIN_PASSWORD`, `SESSION_SECRET`, `ENC_KEY`. Optional: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (otherwise they're stored AES-GCM-encrypted in KV from the admin page).
Box copies: `.secrets/admin_password.txt`, `.secrets/session_secret.txt`, `.secrets/enc_key.txt` and `.secrets/ai_keys.txt`.

## KV keys
`gmail:rt` and `gmail:at` (encrypted), `gmail:state`, `google:client` (encrypted), `key:<ai>` ({hash, enc, created}), `count:<ai>:<SAST date>`, `log:*` (data stored in metadata, 180-day TTL), `sess:<sha256>`, `oauth:<state>`, `labels`, `settings` and `loginfail:*`.

## Google
Redirect URI: `https://ai-mail-hub.livehqfield.workers.dev/oauth/google/callback`. Scopes: gmail.modify and gmail.send, with offline access and prompt=consent. The callback checks that the signed-in account is livehqfield@gmail.com.

## OrderPilot (separate application)
- `/orderpilot`: standalone post-order operations workspace; does not replace `/admin`.
- Initial release is a demo UI with fictional in-memory records only. Do not enter real customer information.
- The prototype route has a restrictive CSP: no outbound network connections, forms, external fonts or frames.
- Before live retailer use, implement authenticated retailer accounts, tenant-scoped persistent storage, audit trails, privacy/retention controls, integration authorization and approval-gated customer communications. See `docs/ORDERPILOT.md`.
