# BlackMail

**One message. Two voices.** [Open the app](https://blackmail-eai-2026.vercel.app)

Write naturally. Review a formal version for the record; share your original privately over encrypted P2P.

## How it works

- Sign in, add a contact by username, and write in one composer.
- **Connected:** Nebius rewrites your draft; review it, then send formal + original.
- **Disconnected:** send formal only. **Review with AI** prepares the text; manual review is available if AI is unavailable.
- Pair once through **Informal setup**. Wait for **Connected · link saved**; this browser remembers the link for seven days.
- Refresh clears informal history, keeps formal records, and reconnects when both peers are online.
- Archived demos and five-minute pass tools live under **Guide**.

Current delivery is inside BlackMail. Goal: formal messages through Gmail/Slack/etc., with originals in a private companion channel. External apps currently require copy/paste.

## Run locally

Node.js 22+.

```bash
npm ci
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
# Configure .env, then:
npm start
```

Open http://127.0.0.1:8787. `GET /api/health` reports `aiEnabled`, `messagingEnabled` and vault `storage` (`shared` Redis, `memory` local, or `unconfigured`). Never commit .env or secret keys.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Accounts, contacts, formal inbox (publishable key only; never a service-role key) |
| `NEBIUS_API_KEY`, `NEBIUS_MODEL` | AI rewrite (`/api/rewrite`); default model `deepseek-ai/DeepSeek-V4-Flash-0731` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`, `KV_REST_API_TOKEN`) | Any HTTPS Redis REST endpoint (Upstash-compatible; no SDK). Pass vault, rate limiting and P2P reconnect signaling; required when hosted on Vercel, optional locally (in-memory fallback) |
| `APP_ORIGIN` | Exact production origin allowed by CORS |

**Checks:** `npm test` (server, messaging, signaling), `npm run test:p2p` (vitest), `npm run typecheck`, `npm run build` (compiles `src/utils/p2p.ts`, copies client to `public/`).

**Layout:** `extension/` browser client (served by the server, Chrome/Edge extension, and Vercel build source) · `server/` HTTP API, vault, Supabase adapter, peer signals · `api/` Vercel entry · `supabase/` migration + RLS tests · `src/utils/` P2P utility and tests · `test/` Node tests · `docs/` setup details. `src/nebius_start_building.py` is a standalone Nebius API example; the app does not use it.

**Extension:** build, then Chrome/Edge > Extensions > Developer mode > Load unpacked > select `extension/`. It uses the production API (`extension/config.js`).

**Deployment:** pushes to `main` deploy through Vercel. Set environment variables from [.env.example](.env.example), then redeploy.

## Privacy & setup

Informal messages use WebRTC + ECDH/AES-GCM. Reconnect credentials stay in this browser; the backend relays encrypted setup tokens. AI rewriting sends your draft to Nebius. Both peers must be online; some networks block P2P. Messages cannot be recalled from screenshots or copies. Prototype; not security-audited.

[Accounts & database](docs/supabase.md) | [P2P setup, tests & limits](docs/p2p.md)
