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

```powershell
npm ci
Copy-Item .env.example .env
# Configure .env, then:
npm start
```

Open http://127.0.0.1:8787. Configure Supabase for accounts, Nebius for AI, and Redis for hosted vault/signaling. Never commit .env or secret keys.

**Checks:** `npm test`, `npm run test:p2p`, `npm run typecheck`, `npm run build`.

**Extension:** build, then Chrome/Edge > Extensions > Developer mode > Load unpacked > select `extension/`. It uses the production API.

**Deployment:** pushes to `main` deploy through Vercel. Set environment variables from [.env.example](.env.example), then redeploy.

## Privacy & setup

Informal messages use WebRTC + ECDH/AES-GCM. Reconnect credentials stay in this browser; the backend relays encrypted setup tokens. AI rewriting sends your draft to Nebius. Both peers must be online; some networks block P2P. Messages cannot be recalled from screenshots or copies. Prototype; not security-audited.

[Accounts & database](docs/supabase.md) | [P2P setup, tests & limits](docs/p2p.md)
