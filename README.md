# BlackMail

One message. Two voices. Browser-extension MVP with local and Vercel hosting modes.

## Run

Node.js 22+; no npm dependencies.

```powershell
npm start
```

Open http://127.0.0.1:8787 for the standalone demo.

For the Chrome/Edge extension:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode → Load unpacked → select this repo's `extension` folder.
3. Click BlackMail in the browser toolbar. It opens the composer in a new tab.
4. Keep the local Node server running.

Optional AI: copy `.env.example` to `.env`, add your Nebius key, restart the server. Without a key, edit both versions manually. Provider/model availability depends on your Nebius account. Your key stays server-side. Clicking **Polish with AI** sends the original draft to that provider.

## Demo flow

1. A writes the original and approves/edits the formal version.
2. **Copy formal** → paste and send through Gmail, Outlook, Slack, Discord, etc.
3. **Create private pass** → share the `bm1...` pass separately with B.
4. B opens BlackMail → **Open a pass** → paste → unlock.
5. A opens **Your passes** → **Revoke original**. The formal message on the other platform stays intact.

For two browser profiles, both must use the same running local server on this computer. This loopback-only MVP does not connect two remote computers. **Preview recipient view** demonstrates the flow in one tab. No third-party app is accessed and no messages are sent automatically.

## Access model

- Each pass expires five minutes after creation, enforced by the server. This is a per-message pass, not a rotating shared password; no automatic renewal.
- Browser encrypts originals with AES-256-GCM and a fresh random key/IV. Server stores ciphertext in memory, a hashed retrieval capability, and a separate hashed revocation capability. Decryption key never goes to the vault API.
- Pass includes message ID, retrieval capability, and decryption key. Anyone holding the complete pass can open it until expiry/revocation. No account binding or mutual-connection verification yet. Share it through a channel you trust.
- Sender history stores formal text and the revocation capability in that browser's local storage. It does not store originals, recipient passes, or encryption keys. Clearing browser data loses revocation controls; five-minute expiry still applies.
- Expired records are purged on vault operations. Revocation deletes the record immediately. Server restart loses all originals; browser history remains.
- Recipient UI clears plaintext on expiry, tab hiding, or closing. While visible it checks server access every three seconds. Revocation cannot recall plaintext already downloaded, screenshots, copies, or modified clients. This is time-limited access, not screenshot prevention or a claim of stronger security than established messengers.
- Only encrypted originals are sent to the vault. Optional AI rewriting separately exposes the draft to the configured provider. Formal text is intentionally persistent wherever the sender sends it; BlackMail cannot guarantee another platform's retention behavior.

## Validation

```powershell
npm test
```

Covers encryption/decryption, wrong keys, server-enforced expiry, revoke authorization, blocked origins, malformed requests, and static-file isolation.

## MVP boundaries

No accounts, authenticated recipients, direct platform integrations, or production security audit. Copy/paste works across platforms; native-app extensions are not included. Local mode uses memory; Vercel mode requires shared Redis storage and fails closed without it. Recipient binding and identity remain future work.

The original `src/nebius_start_building.py` starter is preserved. Extension and local server use Node.js instead.

## Vercel hosting

1. Push these changes to your GitHub repo; import the repo into Vercel.
2. Framework preset: **Other**. `vercel.json` supplies build command (`npm run build`), output directory (`public`), and API routing. Node.js 22+.
3. Connect an Upstash Redis database (via Vercel Marketplace or your existing Upstash account). Set server-side environment variables `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the Vercel project. Use REST credentials, not a `redis://` connection string. Do not put secrets in frontend config or source control.
4. Optional: set `NEBIUS_API_KEY` and `NEBIUS_MODEL` for rewriting. Without these, users edit both versions manually.
5. Set `APP_ORIGIN` to the exact production origin (e.g. `https://your-project.vercel.app`), then deploy/redeploy. Vercel's automatic deployment and production URLs are also allowed.
6. Check `/api/health`: expect `"ok":true` and `"storage":"shared"`. Test creating a pass in one browser, unlocking in another, and revoking. A rendered homepage alone does not verify backend configuration.

Hosted web client automatically calls its own origin. For the unpacked extension to use your hosted API, change `EXTENSION_API` in `extension/config.js` to your production HTTPS origin. Replace the localhost entries in `host_permissions` and CSP `connect-src` in `extension/manifest.json` with that exact origin, then reload the extension.

Redis stores ciphertext and hashed capabilities with a five-minute TTL. Expiry and revocation work across function instances. Shared per-IP rate limiting uses Redis too. Local storage still retains sender history; deleting cloud originals does not remove formal messages sent on other platforms. Storage-provider backup/retention policies also apply; this is not a guarantee of physical erasure from provider backups.

`npm test` includes mocked Redis adapter/TTL and missing-hosted-storage tests. Live Vercel routing, actual Redis Lua execution, and provider credentials must be verified after provisioning. No deployment is created merely by adding these files.
