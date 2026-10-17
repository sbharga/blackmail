const usernamePattern = /^[a-z][a-z0-9_]{2,23}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isPublishableKey(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('sb_publishable_')) return key.length > 20;
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; }
  catch { return false; }
}
export function createMessaging({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY, fetchImpl = fetch } = {}) {
  const enabled = Boolean(url?.startsWith('https://') && isPublishableKey(key));
  const fail = (status, message) => Object.assign(new Error(message), { status });
  async function request(path, { token, body, method = 'POST' } = {}) {
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(`${url.replace(/\/$/, '')}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000)
    });
    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : null; } catch { throw fail(502, 'Account service returned an invalid response.'); }
    if (!response.ok) {
      const status = response.status === 401 || response.status === 403 ? 401 : response.status === 429 ? 429 : 400;
      const message = status === 401 ? 'Session expired. Please sign in again.' : status === 429 ? 'Too many attempts. Please wait before trying again.' :
        path.startsWith('/auth/') ? result?.msg || result?.error_description || result?.message || 'Authentication failed.' :
          result?.code === 'P0001' ? result.message : 'Message request failed. Check your contact and project setup.';
      throw fail(status, message);
    }
    return result;
  }
  function bearer(header) {
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(header)) throw fail(401, 'Please sign in first.');
    return header.slice(7);
  }
  return {
    enabled,
    async handle(path, header, body) {
      if (!path.startsWith('/api/messaging/')) return null;
      if (!enabled) return { status: 503, body: { error: 'Messaging is not configured yet. Connect a Supabase project first.' } };
      try {
        const route = path.slice('/api/messaging/'.length);
        if (route === 'signup' || route === 'login') {
          const email = typeof body.email === 'string' ? body.email.trim() : '';
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) throw fail(400, 'Enter a valid email and a password of 8–128 characters.');
          const payload = { email, password: body.password };
          if (route === 'signup') {
            const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
            const name = typeof body.displayName === 'string' ? body.displayName.trim() : '';
            if (!usernamePattern.test(username) || !name || name.length > 60) throw fail(400, 'Choose a name and a username: 3–24 lowercase letters, numbers or underscores, starting with a letter.');
            payload.data = { username, display_name: name };
          }
          const result = await request(route === 'signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', { body: payload });
          // Supabase returns a session directly on login / confirmation-disabled signup.
          return { status: 200, body: result?.access_token ? { session: { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: result.expires_at || Math.floor(Date.now() / 1000) + result.expires_in } } : { needsConfirmation: true } };
        }
        if (route === 'refresh') {
          if (typeof body.refreshToken !== 'string' || body.refreshToken.length < 10 || body.refreshToken.length > 8192) throw fail(400, 'Invalid refresh session.');
          const result = await request('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: body.refreshToken } });
          if (!result?.access_token || !result.refresh_token) throw fail(502, 'Session could not be refreshed.');
          return { status: 200, body: { session: { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: result.expires_at || Math.floor(Date.now() / 1000) + result.expires_in } } };
        }
        const token = bearer(header);
        if (route === 'logout') {
          await request('/auth/v1/logout?scope=local', { token });
          return { status: 200, body: { ok: true } };
        }
        if (route === 'me') {
          const user = await request('/auth/v1/user', { token, method: 'GET' });
          const rows = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,username,display_name&limit=1`, { token, method: 'GET' });
          if (!rows?.[0]) throw fail(409, 'Profile missing. Apply the BlackMail database migration before signing up.');
          return { status: 200, body: { profile: rows[0] } };
        }
        if (route === 'contacts') return { status: 200, body: { contacts: await request('/rest/v1/rpc/list_contacts', { token, body: {} }) } };
        if (route === 'contacts/add') {
          const username = typeof body.username === 'string' ? body.username.trim().toLowerCase().replace(/^@/, '') : '';
          if (!usernamePattern.test(username)) throw fail(400, 'Enter your contact’s exact username.');
          return { status: 200, body: { contact: await request('/rest/v1/rpc/add_contact', { token, body: { p_username: username } }) } };
        }
        if (route === 'thread') {
          if (!uuidPattern.test(body.contactId)) throw fail(400, 'Choose a contact first.');
          return { status: 200, body: { messages: await request('/rest/v1/rpc/get_formal_thread', { token, body: { p_contact: body.contactId } }) } };
        }
        if (route === 'send') {
          if (!uuidPattern.test(body.recipientId) || !uuidPattern.test(body.clientMessageId) || typeof body.formal !== 'string' || !body.formal.trim() || body.formal.length > 6000) throw fail(400, 'Choose a recipient and write a formal message of up to 6,000 characters.');
          // Deliberate allowlist. Original text and sender IDs never come from this request.
          const message = await request('/rest/v1/rpc/send_formal_message', { token, body: { p_recipient: body.recipientId, p_body: body.formal.trim(), p_client_message_id: body.clientMessageId } });
          return { status: 201, body: { message } };
        }
        return { status: 404, body: { error: 'Messaging route not found.' } };
      } catch (error) {
        return { status: error.status || 502, body: { error: error.status ? error.message : 'Account service unavailable. Please try again.' } };
      }
    }
  };
}
