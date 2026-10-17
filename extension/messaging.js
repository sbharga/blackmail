import { api, serverNow } from './app.js';

const $ = id => document.getElementById(id);
const node = (tag, className, text) => {
  const result = document.createElement(tag); if (className) result.className = className;
  if (text !== undefined) result.textContent = text; return result;
};
let session = null;
try { session = JSON.parse(sessionStorage.getItem('blackmail.auth') || 'null'); } catch {}
if (!session?.access_token || !session?.refresh_token || !Number.isFinite(session.expires_at)) session = null;
let profile = null, contacts = [], selected = null, signup = false, enabled = false;
let epoch = 0, revision = 0, refreshPromise = null, syncing = false, sending = false, polishing = false;
let contactsAt = 0, threadFingerprint = '', pendingMessageId = null;
const accountStatus = text => { $('account-status').textContent = text; };
const inboxStatus = text => { $('inbox-status').textContent = text; };
function storeSession(value) {
  session = value;
  try { if (value) sessionStorage.setItem('blackmail.auth', JSON.stringify(value)); else sessionStorage.removeItem('blackmail.auth'); }
  catch { /* In-memory login remains usable when browser storage is unavailable. */ }
}
function invalidatePreview() {
  revision++; pendingMessageId = null;
  $('live-preview').classList.add('hidden'); $('live-formal').value = '';
}
function clearAccount(message = '') {
  epoch++; storeSession(null); profile = null; contacts = []; selected = null; contactsAt = 0;
  threadFingerprint = ''; refreshPromise = null;
  $('live-inbox').classList.add('hidden'); $('account-gate').classList.remove('hidden');
  $('live-draft').value = ''; invalidatePreview(); $('live-messages').replaceChildren(); $('live-contacts').replaceChildren();
  accountStatus(message);
}
async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const previous = session, started = epoch;
  if (!previous?.refresh_token) throw new Error('Please sign in again.');
  const promise = (async () => {
    let result;
    try { result = await api('/api/messaging/refresh', { refreshToken: previous.refresh_token }); }
    catch (error) { if (started === epoch && [400, 401].includes(error.status)) clearAccount('Session ended. Please sign in again.'); throw error; }
    if (started !== epoch || session !== previous) throw new Error('Account changed. Please try again.');
    storeSession(result.session);
  })();
  refreshPromise = promise;
  try { await promise; } finally { if (refreshPromise === promise) refreshPromise = null; }
}
async function call(route, body = {}, retry = true) {
  const started = epoch;
  if (!session) throw new Error('Please sign in first.');
  if (session.expires_at * 1000 <= serverNow() + 30000) await refreshSession();
  if (started !== epoch || !session) throw new Error('Account changed. Please sign in again.');
  try { return await api(`/api/messaging/${route}`, body, 'POST', session.access_token); }
  catch (error) {
    if (started !== epoch) throw new Error('Account changed.');
    if (error.status === 401 && retry) {
      try { await refreshSession(); return await call(route, body, false); }
      catch (refreshError) { if (started === epoch) clearAccount('Session ended. Please sign in again.'); throw refreshError; }
    }
    throw error;
  }
}
function mode(value) {
  signup = value;
  $('signup-fields').classList.toggle('hidden', !signup);
  $('account-name').required = signup; $('account-username').required = signup;
  $('account-password').autocomplete = signup ? 'new-password' : 'current-password';
  $('account-login-mode').setAttribute('aria-pressed', String(!signup));
  $('account-signup-mode').setAttribute('aria-pressed', String(signup));
  $('account-submit').textContent = signup ? 'Create account ↗' : 'Sign in ↗';
  accountStatus('');
}
$('account-login-mode').addEventListener('click', () => mode(false));
$('account-signup-mode').addEventListener('click', () => mode(true));
$('account-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!enabled) { accountStatus('Connect Supabase before creating an account.'); return; }
  const started = ++epoch;
  $('account-submit').disabled = true; accountStatus(signup ? 'Creating your account…' : 'Signing in…');
  try {
    const result = await api(`/api/messaging/${signup ? 'signup' : 'login'}`, {
      email: $('account-email').value, password: $('account-password').value,
      username: $('account-username').value, displayName: $('account-name').value
    });
    if (started !== epoch) return;
    if (result.needsConfirmation) { mode(false); accountStatus('Check your email to confirm your account, then sign in here.'); return; }
    storeSession(result.session); await openInbox();
  } catch (error) { if (started === epoch) accountStatus(error.message); }
  finally { $('account-password').value = ''; $('account-submit').disabled = !enabled; }
});
async function openInbox() {
  const started = epoch;
  const result = await call('me');
  if (started !== epoch) return;
  profile = result.profile;
  $('account-identity').textContent = `${profile.display_name} · @${profile.username}`;
  $('account-gate').classList.add('hidden'); $('live-inbox').classList.remove('hidden');
  contactsAt = 0; await sync(true);
}
function selectContact(contact) {
  if (sending) { inboxStatus('Finish sending before changing conversation.'); return; }
  selected = contact; threadFingerprint = '';
  $('live-contact-name').textContent = contact.display_name;
  $('live-contact-username').textContent = `@${contact.username}`;
  $('live-avatar').textContent = contact.display_name[0]?.toUpperCase() || '?';
  $('live-draft').value = ''; invalidatePreview();
  $('live-draft').disabled = false; $('live-polish').disabled = false; $('live-review').disabled = false;
  $('live-messages').replaceChildren(node('p', 'empty-inbox', 'Loading conversation…'));
  drawContacts(); inboxStatus(''); sync(true);
}
function drawContacts() {
  const list = $('live-contacts'); list.replaceChildren();
  if (!contacts.length) list.append(node('p', 'messaging-note', 'Add a teammate by their exact username.'));
  for (const contact of contacts) {
    const button = node('button', `contact ${selected?.id === contact.id ? 'selected' : ''}`);
    button.setAttribute('aria-label', `Message @${contact.username}`);
    button.setAttribute('aria-pressed', String(selected?.id === contact.id));
    const detail = node('span', 'contact-details live-contact-details');
    detail.append(node('strong', '', contact.display_name), node('small', '', `@${contact.username}`));
    button.append(node('span', 'avatar bob', contact.display_name[0]?.toUpperCase() || '?'), detail);
    button.addEventListener('click', () => selectContact(contact)); list.append(button);
  }
}
function drawMessages(messages) {
  const fingerprint = JSON.stringify(messages);
  if (fingerprint === threadFingerprint) return;
  threadFingerprint = fingerprint;
  const list = $('live-messages'); const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
  list.replaceChildren();
  if (!messages.length) list.append(node('p', 'empty-inbox', 'No messages yet. Say hello.'));
  for (const message of messages) {
    const mine = message.sender_id === profile.id;
    const row = node('article', `message-row ${mine ? 'outgoing' : 'incoming'}`);
    const bubble = node('div', 'message-bubble');
    bubble.append(node('div', 'message-author', mine ? `${profile.display_name} · you` : selected.display_name), node('p', '', message.body_formal));
    const date = new Date(message.created_at);
    bubble.append(node('div', 'message-meta', `${date.toLocaleString()} · formal record`));
    row.append(bubble); list.append(row);
  }
  if (atEnd) list.scrollTop = list.scrollHeight;
}
async function sync(forceContacts = false) {
  if (!profile || !session || syncing) return;
  syncing = true;
  const started = epoch;
  try {
    if (forceContacts || serverNow() - contactsAt > 10000) {
      const result = await call('contacts');
      if (started !== epoch) return;
      const changed = JSON.stringify(contacts) !== JSON.stringify(result.contacts);
      contacts = result.contacts; contactsAt = serverNow();
      if (changed) drawContacts();
    }
    const contact = selected;
    if (contact) {
      const result = await call('thread', { contactId: contact.id });
      if (started === epoch && selected?.id === contact.id) drawMessages(result.messages);
    }
  } catch (error) { if (started === epoch && session) inboxStatus(error.message); }
  finally { syncing = false; }
}
$('inbox-refresh').addEventListener('click', () => sync(true));
$('add-contact-form').addEventListener('submit', async event => {
  event.preventDefault(); const started = epoch; const username = $('contact-username').value.trim().replace(/^@/, '').toLowerCase();
  $('add-contact-submit').disabled = true;
  try {
    await call('contacts/add', { username });
    if (started !== epoch) return;
    const result = await call('contacts');
    if (started !== epoch) return;
    contacts = result.contacts; $('contact-username').value = ''; drawContacts();
    const contact = contacts.find(item => item.username === username);
    if (contact) selectContact(contact);
    inboxStatus('Contact added. Only formal messages are sent from this inbox.');
  } catch (error) { if (started === epoch) inboxStatus(error.message); }
  finally { $('add-contact-submit').disabled = false; }
});
$('account-logout').addEventListener('click', async () => {
  const token = session?.access_token; clearAccount('Signed out.');
  if (token) try { await api('/api/messaging/logout', {}, 'POST', token); } catch { /* Local session is already cleared. */ }
});
$('live-draft').addEventListener('input', invalidatePreview);
$('live-formal').addEventListener('input', () => { pendingMessageId = null; });
$('live-review').addEventListener('click', () => {
  if (!selected || !$('live-draft').value.trim()) { inboxStatus('Write a draft first.'); return; }
  if ($('live-preview').classList.contains('hidden')) {
    $('live-formal').value = $('live-draft').value;
    $('live-preview').classList.remove('hidden');
    inboxStatus('Edit the formal version, or use AI. Only this version will be sent.');
  }
  $('live-formal').focus();
});
$('live-polish').addEventListener('click', async () => {
  if (polishing || sending) return;
  const text = $('live-draft').value;
  if (!selected || !text.trim()) { inboxStatus('Write a draft first.'); return; }
  const started = epoch, currentRevision = revision;
  polishing = true; $('live-polish').disabled = true; inboxStatus('Polishing with Nebius…');
  try {
    const result = await api('/api/rewrite', { text });
    if (started !== epoch || currentRevision !== revision) return;
    $('live-formal').value = result.text; pendingMessageId = null;
    $('live-preview').classList.remove('hidden'); inboxStatus('Review the formal version before sending.');
  } catch (error) { if (started === epoch) inboxStatus(error.message); }
  finally { polishing = false; $('live-polish').disabled = !selected || sending; }
});
$('live-cancel').addEventListener('click', () => { invalidatePreview(); inboxStatus('Draft kept.'); });
$('live-send').addEventListener('click', async () => {
  if (sending || !selected) return;
  const formal = $('live-formal').value.trim();
  if (!formal) { inboxStatus('Write the formal version first.'); return; }
  const contact = selected, started = epoch, currentRevision = revision;
  pendingMessageId ||= crypto.randomUUID();
  const clientMessageId = pendingMessageId;
  sending = true;
  for (const id of ['live-send', 'live-formal', 'live-draft', 'live-review', 'live-polish', 'live-cancel']) $(id).disabled = true;
  inboxStatus('Sending formal message…');
  try {
    await call('send', { recipientId: contact.id, formal, clientMessageId });
    if (started !== epoch) return;
    if (currentRevision === revision && selected?.id === contact.id) { $('live-draft').value = ''; invalidatePreview(); }
    inboxStatus(`Formal message delivered to ${contact.display_name}.`);
    threadFingerprint = ''; await sync(true);
    $('live-messages').scrollTop = $('live-messages').scrollHeight;
  } catch (error) { if (started === epoch) inboxStatus(`${error.message} Retry safely; the same message won’t be duplicated.`); }
  finally {
    sending = false;
    for (const id of ['live-send', 'live-formal', 'live-draft', 'live-review', 'live-polish', 'live-cancel']) $(id).disabled = !selected;
  }
});
document.querySelector('[data-tab="messaging"]').addEventListener('click', () => sync(true));
setInterval(() => { if (!document.hidden && !$('messaging').classList.contains('hidden')) sync(); }, 3000);
// Availability only: project URL and API keys never need to reach the browser.
fetch(`${location.protocol === 'chrome-extension:' ? (await import('./config.js')).EXTENSION_API : location.origin}/api/health`)
  .then(response => response.json()).then(async health => {
    enabled = health.messagingEnabled === true;
    $('account-submit').disabled = !enabled;
    if (!enabled) { accountStatus('Messaging setup pending. Try Chat demo, or ask the project owner to connect Supabase.'); return; }
    if (session) {
      try { await openInbox(); } catch (error) { clearAccount(error.message); }
    } else accountStatus('Sign in, or create an account to get your username.');
  }).catch(() => { $('account-submit').disabled = true; accountStatus('Account service unavailable. Please refresh.'); });
