# Informal P2P channel

In **Messages**, sign in and select a contact. Open **Informal setup**.

1. Alice creates an offer and shares the token with Bob through a trusted channel.
2. Bob selects Alice, pastes her offer, clicks **Answer pasted offer**, and shares his answer.
3. Alice pastes Bob's answer and clicks **Apply pasted answer**. Keep both tabs open until both show Connected.
4. Write in the single message composer. Connected: **Review formal** automatically calls Nebius; review/edit its output, then **Send both versions**. The approved formal text goes to Supabase first, and the original goes over P2P. Disconnected: review/send formal only; AI is optional.

Setup has no separate informal composer. Both message types appear in the same conversation with channel labels. AI must succeed for the current draft before a connected dual send; failures leave the draft for review/retry. If the private channel drops after formal delivery, the UI reports that only formal succeeded, without automatically resending the formal record. Connection state is checked when Send is clicked.

The supplied `src/utils/p2p.ts` is unchanged. TypeScript compiles it to `extension/p2p.js` for the dependency-free browser client. Install build tools with `npm ci`; `npm start` and `npm run build` compile automatically. Run `npm run typecheck`, `npm run test:p2p`, and `npm test`.

Informal text uses WebRTC DataChannels plus the utility's ECDH P-256/AES-256-GCM encryption. It never enters the formal API, Nebius, Redis or Supabase. The UI keeps at most 100 informal messages in memory, separate from the persistent formal record. Switching contact, signout or reload clears the local informal view. A channel round-trip probe confirms readiness; handshake times out after two minutes and missing probes mark the channel disconnected after 20 seconds.

Limits: manual token exchange establishes the peer; Supabase usernames are not cryptographically bound to peer IDs. Verify the person through your trusted token-exchange channel. SDP tokens can contain network addresses; do not publish them. Google/Twilio STUN servers assist discovery; this is not literally infrastructure-free. No TURN relay is configured, so some NAT/firewall combinations cannot connect. Both peers must be online; no offline delivery, timed expiry or remote deletion. Reload fully closes browser connections; the supplied utility exposes no production disconnect API. Resetting UI state ignores old peers but cannot close those underlying channels. Tests cover real WebCrypto and mocked transport state; they do not establish cross-network connectivity.

The attachment mentioned existing P2P tests, but no test file was attached or present. Added regression coverage in `src/utils/tests/p2p.test.ts`. A real Chrome two-tab check also passed: test1/test2 signed in, exchanged manual tokens, both reached Connected, and sent/received informal messages in both directions. Cross-network NAT traversal remains unverified.
