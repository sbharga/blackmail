# BlackMail

**One message. Two voices.** [Open the app](https://blackmail-eai-2026.vercel.app)

Write naturally. Review a formal version for the record; share your original privately over encrypted P2P.

## How it works

- Sign in, add a contact by username, and write in one composer.
- **Connected:** Nebius rewrites your draft; review it, then send formal + original.
- **Disconnected:** send formal only; AI is optional.
- Pair once through **Informal setup**. Wait for **Connected · link saved**; this browser remembers the link for seven days.
- Refresh clears informal history, keeps formal records, and reconnects when both peers are online.
- Archived demos and five-minute pass tools live under **Guide**.

Current delivery is inside BlackMail. Goal: formal messages through Gmail/Slack/etc., with originals in a private companion channel. External apps currently require copy/paste.

## Tech stack

BlackMail is deliberately dependency-light: a vanilla ES-module browser client and a Node built-in `http` API, with managed services (Supabase, Redis, Nebius) behind the server and WebRTC between peers. There are no runtime npm packages; the only build-time tooling is TypeScript and Vitest, for the single P2P module.

| Layer | Technology | How it ties into the app |
| --- | --- | --- |
| Client | Vanilla HTML / CSS / ES modules (no framework) · Chrome/Edge **Manifest V3** extension | `extension/` is the entire front end — the dark messaging UI (`messaging.js`), the informal-setup/status panels (`peer-ui.js`), and the archived chat demo + five-minute pass tools under **Guide** (`demo.js`). Served three ways from one source: by the Node server, as an unpacked extension (`manifest.json` + `background.js`), and as Vercel's static output. A strict CSP forces all JS/CSS external (no inline). |
| Browser crypto | **Web Crypto API** — AES-256-GCM, ECDH P-256, SHA-256 | Originals are encrypted in the browser and keys never reach the server. Powers both the short-lived pass vault (`app.js`) and the peer-to-peer channel (`p2p.ts`). |
| API server | **Node.js 22** built-in `http` (no Express) — one handler for local + serverless | `server/index.js` runs via `npm start` and, unchanged, as the Vercel function `api/index.js`. It serves the client and routes `/api/health`, `/api/rewrite`, the pass vault (`/api/messages…`), Supabase messaging (`/api/messaging/*`) and peer signaling — behind a CORS allow-list and per-IP rate limiting, with timing-safe capability checks. |
| Accounts & formal record | **Supabase** — Postgres + Auth with Row-Level Security | Real accounts, contacts, and the persistent **formal** inbox. RLS restricts every row to sender/recipient and blocks impersonation; the server uses the publishable key plus the user's JWT (never a service-role key). `server/supabase.js`, `supabase/migrations/`, `supabase/tests/rls.sql`. |
| Ephemeral vault & signaling | **Upstash-compatible Redis (REST)** — in-memory fallback locally | Holds the 5-minute "pass" records (ciphertext + hashed capabilities only), per-IP rate limits, and the 90-second AES-GCM reconnect tokens that let paired peers re-establish a socket. `server/redis-vault.js`, `server/vault.js`, `server/peer-signals.js`. |
| Informal channel | **WebRTC DataChannels** + **ECDH P-256 / AES-256-GCM** (`src/utils/p2p.ts`) | The **original** message travels directly peer-to-peer, end-to-end encrypted — it never touches Supabase, Redis, Nebius, or the API. Google/Twilio **STUN** assists discovery (no TURN relay). Client orchestration: `p2p-session.js`, `message-delivery.js`, `peer-reconnect.js`. |
| AI rewrite | **Nebius** chat-completions (default `deepseek-ai/DeepSeek-V4-Flash-0731`) | `POST /api/rewrite` turns your casual draft into the formal version. The key stays server-side; only the draft you choose to polish is sent. |
| Hosting & build | **Vercel** (static `public/` + serverless function) | `scripts/build-p2p.mjs` compiles `p2p.ts` → `extension/p2p.js`; `scripts/build.mjs` copies the client into `public/`. Security headers are set in both `vercel.json` and the server. |
| Tests | Node `--test` · **Vitest** + **TypeScript** (`--strict`) · Supabase RLS SQL | `test/*.test.js` (API, messaging, signaling, delivery), `src/utils/tests/` (P2P crypto), `supabase/tests/rls.sql` (row security). |

**End to end:** you sign in (Supabase issues a JWT) → add a contact by username → write one draft in a single composer → the server asks **Nebius** to produce the formal version → on **send**, the approved formal text is written to **Supabase** as the record, while the **original** is encrypted with **Web Crypto** and delivered over the **WebRTC** DataChannel straight to your peer, off-server. The **Redis** pass vault stays available under **Guide** for handing an original to someone you haven't paired with yet.

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
