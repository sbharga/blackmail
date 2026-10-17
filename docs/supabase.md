# Supabase messaging setup

Branch: `supabase-messaging`. Adds real BlackMail accounts and a formal inbox; not Gmail/Slack sending.

Preview: https://blackmail-eai-2026-git-supabase-messaging-tien-cb97.vercel.app

Vercel currently protects previews with its own sign-in. Test this branch in the web preview with Vercel access. Cross-origin extension API access is not verified under that protection; use a public backend when preparing the production merge. No preview protection was disabled.

1. Create a Supabase Free project. Enable Data API; keep email confirmation enabled.
2. Run `supabase/migrations/202610170001_formal_messaging.sql` once in SQL Editor.
3. Run `supabase/tests/rls.sql`. Expect “RLS checks passed”; fixtures roll back.
4. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in local `.env` / Vercel. A legacy anon key is accepted as `SUPABASE_ANON_KEY`. Never use a secret/service-role key: it bypasses row security and is rejected by the app.
5. Configure Auth Site URL to the deployment you’re testing. Redeploy after setting environment variables. `/api/health` should report `messagingEnabled: true`.
6. Create two app accounts in separate browser profiles, confirm both emails, then sign in. Add the other person by exact username, review a formal message, and send. Recipient sees the sender in their contacts and can reply. A third account must not see that conversation.

## Boundaries

- Postgres RLS limits messages to sender/recipient and prevents sender impersonation. Formal records are append-only for app users.
- API uses the publishable key plus the user’s JWT. No admin key is needed at runtime.
- Only approved `body_formal` is written. Original drafts stay on the tab; AI rewriting separately sends drafts to Nebius. Informal encrypted delivery belongs to `encrypted-dm`.
- Sessions persist in per-tab `sessionStorage` and refresh automatically. Sign-out clears the tab’s tokens and conversation. Closing the tab ends local persistence.
- New messages poll every three seconds while the inbox is visible; contacts refresh periodically. Latest 100 messages are shown. Email delivery is handled by Supabase Auth; production use needs a suitable SMTP configuration.
- Usernames are discoverable by exact lookup. Adding a contact is one-way; there is no mutual acceptance or block/report flow yet.
- Live RLS tests passed on the provisioned project, including two-way delivery, duplicate protection, sender spoof rejection, and third-party isolation. Fixtures rolled back. Actual two-account email confirmation/login still requires a browser check. `npm test` covers the API adapter with mocked upstream responses; it does not replace database tests.

Keep this branch isolated until reviewed. Its Git push should create a Vercel Preview; do not merge into `main` merely to test it.
