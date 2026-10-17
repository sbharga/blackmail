import { setupPeerUI } from './peer-ui.js';
import { deliverMessage } from './message-delivery.js';
import { messageView } from './message-view.js';
import { api, serverNow } from './app.js';

const $ = id => document.getElementById(id);
const node = (tag, className, text) => {
  const result = document.createElement(tag); if (className) result.className = className;
  if (text !== undefined) result.textContent = text; return result;
};
const peerUI = setupPeerUI();
let session = null;
let confirmationNotice = '';
// Email confirmation may return credentials in the fragment. Require explicit
// password sign-in and remove those credentials from the visible URL/history.
const confirmation = new URLSearchParams(location.hash.slice(1));
if (confirmation.has('access_token') || confirmation.has('error_description')) {
  confirmationNotice = confirmation.has('error_description') ? 'Confirmation link invalid or expired. Try signing in if you already confirmed your email.' : 'Email confirmed. Sign in to continue.';
  window.history.replaceState(null, '', location.pathname + location.search);
}
try { session = JSON.parse(sessionStorage.getItem('blackmail.auth') || 'null'); } catch {}
if (!session?.access_token || !session?.refresh_token || !Number.isFinite(session.expires_at)) session = null;
let profile = null, contacts = [], selected = null, signup = false, enabled = false;
let epoch = 0, revision = 0, refreshPromise = null, syncing = false, sending = false, polishing = false;
let contactsAt = 0, threadFingerprint = '', pendingMessageId = null;
let aiRevision = -1, formalMessages = [];
let reading = 'formal';
let syncAgain = false;
const accountStatus = text => { $('account-status').textContent = text; };
const inboxStatus = text => { $('inbox-status').textContent = text; };
function storeSession(value) {
  session = value;
  try { if (value) sessionStorage.setItem('blackmail.auth', JSON.stringify(value)); else sessionStorage.removeItem('blackmail.auth'); }
  catch { /* In-memory login remains usable when browser storage is unavailable. */ }
}
function invalidatePreview() {
  revision++; pendingMessageId = null; aiRevision = -1;
  $('live-preview').classList.add('hidden'); $('live-formal').value = '';
}
function clearAccount(message = '') {
  syncAgain = false;
  formalMessages = [];
  peerUI.select(null);
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
    storeSession(result.session); await openInbox(false);
  } catch (error) { if (started === epoch) accountStatus(error.message); }
  finally { $('account-password').value = ''; $('account-submit').disabled = !enabled; }
});
async function openInbox(restore = true) {
  const started = epoch;
  const result = await call('me');
  if (started !== epoch) return;
  profile = result.profile;
  peerUI.account(profile.id, call);
  $('account-identity').textContent = `${profile.display_name} · @${profile.username}`;
  $('account-avatar').textContent = profile.display_name[0]?.toUpperCase() || '?';
  $('welcome-name').textContent = profile.display_name;
  showOverview();
  $('account-gate').classList.add('hidden'); $('live-inbox').classList.remove('hidden');
  contactsAt = 0; await sync(true);
  if (started !== epoch) return;
  try {
    const previous = sessionStorage.getItem(`blackmail.selected:${profile.id}`);
    const contact = contacts.find(item => item.id === previous);
    if (restore && contact) selectContact(contact);
    else if (!restore) sessionStorage.removeItem(`blackmail.selected:${profile.id}`);
  } catch { /* Contact selection remains usable without storage. */ }
}
function showOverview() {
  if (sending) return;
  selected = null; formalMessages = []; threadFingerprint = '';
  document.querySelector('.live-chat .chat-main').classList.add('welcome-mode');
  $('live-draft').value = ''; $('live-draft').disabled = true; $('live-review').disabled = true;
  invalidatePreview(); drawContacts(); inboxStatus('');
}
$('inbox-home').addEventListener('click', () => {
  if (sending) return;
  showOverview();
  try { sessionStorage.removeItem(`blackmail.selected:${profile.id}`); } catch {}
});
$('welcome-add').addEventListener('click', () => $('contact-username').focus());
function selectContact(contact) {
  if (selected?.id === contact.id) return;
  if (sending) { inboxStatus('Finish sending before changing conversation.'); return; }
  formalMessages = []; selected = contact; threadFingerprint = '';
  document.querySelector('.live-chat .chat-main').classList.remove('welcome-mode');
  if (peerUI.snapshot().contact !== contact.id) peerUI.select(contact);
  try { sessionStorage.setItem(`blackmail.selected:${profile.id}`, contact.id); } catch {}
  $('live-contact-name').textContent = contact.display_name;
  $('live-contact-username').textContent = `@${contact.username}`;
  $('live-avatar').textContent = contact.display_name[0]?.toUpperCase() || '?';
  $('live-draft').value = ''; invalidatePreview();
  $('live-draft').disabled = false; $('live-review').disabled = false;
  $('live-messages').replaceChildren(node('p', 'empty-inbox', 'Loading conversation…'));
  drawContacts(); inboxStatus(''); sync(true);
}
function drawContacts() {
  $('welcome-contacts').textContent = contacts.length ? `${contacts.length} ${contacts.length === 1 ? 'contact' : 'contacts'} ready to chat` : 'Add your first contact to start';
  $('inbox-home').classList.toggle('selected', !selected);
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
  formalMessages = messages;
  const informal = peerUI.snapshot().messages;
  const fingerprint = JSON.stringify([messages, informal, reading]);
  if (fingerprint === threadFingerprint) return;
  threadFingerprint = fingerprint;
  const list = $('live-messages'); const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
  list.replaceChildren();
  const combined = messageView(messages, informal, profile.id, reading);
  if (!combined.length) list.append(node('p', 'empty-inbox', 'No messages yet. Say hello.'));
  let day = '';
  for (const message of combined) {
    const date = new Date(message.at), dateKey = date.toDateString();
    if (dateKey !== day) {
      day = dateKey;
      const today = new Date(serverNow()), yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
      const label = dateKey === today.toDateString() ? 'Today' : dateKey === yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      list.append(node('div', 'conversation-day', label));
    }
    const mine = message.mine;
    const row = node('article', `message-row ${mine ? 'outgoing' : 'incoming'}`);
    const bubble = node('div', 'message-bubble');
    if (message.private) bubble.classList.add('informal-bubble');
    if (!mine) bubble.append(node('div', 'message-author', selected.display_name));
    if (message.private) bubble.append(node('div', 'original-label', 'Original'));
    bubble.append(node('p', '', message.text));
    row.append(bubble); list.append(row);
  }
  if (atEnd) list.scrollTop = list.scrollHeight;
}
function setReading(value) {
  reading = value;
  $('reading-formal').setAttribute('aria-pressed', String(value === 'formal'));
  $('reading-blackmail').setAttribute('aria-pressed', String(value === 'blackmail'));
  document.querySelector('.live-chat').classList.toggle('blackmail-view', value === 'blackmail');
  $('reading-note').textContent = value === 'blackmail' ? 'Originals where available. Formal record otherwise; originals clear on refresh.' : '';
  $('reading-note').classList.toggle('hidden', value !== 'blackmail');
  threadFingerprint = ''; if (profile && selected) drawMessages(formalMessages);
}
$('reading-formal').addEventListener('click', () => setReading('formal'));
$('reading-blackmail').addEventListener('click', () => setReading('blackmail'));
function connected() { const peer = peerUI.snapshot(); return peer.state === 'Connected' && peer.contact === selected?.id; }
function updateDeliveryMode() {
  $('delivery-mode').textContent = connected()
    ? 'Both channels: Nebius prepares the formal record; your original goes directly over P2P.'
    : 'Formal only. Connect the informal channel to send both versions.';
  $('live-send').textContent = connected() ? 'Send both versions' : 'Send formal message';
}
document.addEventListener('blackmail-peer-change', () => {
  updateDeliveryMode();
  if (profile && selected) drawMessages(formalMessages);
});
async function sync(forceContacts = false) {
  if (!profile || !session) return;
  if (syncing) { if (forceContacts) syncAgain = true; return; }
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
  finally {
    syncing = false;
    if (syncAgain && profile && session) { syncAgain = false; queueMicrotask(() => sync(true)); }
  }
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
    inboxStatus('Contact added. Connect the informal channel to send both versions.');
  } catch (error) { if (started === epoch) inboxStatus(error.message); }
  finally { $('add-contact-submit').disabled = false; }
});
$('account-logout').addEventListener('click', async () => {
  const token = session?.access_token; clearAccount('Signed out.');
  if (token) try { await api('/api/messaging/logout', {}, 'POST', token); } catch { /* Local session is already cleared. */ }
});
$('live-draft').addEventListener('input', invalidatePreview);
$('live-formal').addEventListener('input', () => { pendingMessageId = null; });
$('live-review').addEventListener('click', async () => {
  if (!selected || !$('live-draft').value.trim()) { inboxStatus('Write a draft first.'); return; }
  if (aiRevision !== revision) { await polishDraft(); return; }
  $('live-preview').classList.remove('hidden');
  $('live-formal').focus();
});
async function polishDraft() {
  if (polishing || sending) return;
  const text = $('live-draft').value;
  if (!selected || !text.trim()) { inboxStatus('Write a draft first.'); return; }
  const started = epoch, currentRevision = revision;
  polishing = true; $('live-review').disabled = true; $('live-send').disabled = true; inboxStatus('Preparing your review with Nebius…');
  try {
    const result = await api('/api/rewrite', { text });
    if (started !== epoch || currentRevision !== revision) return;
    $('live-formal').value = result.text; pendingMessageId = null; aiRevision = currentRevision;
    $('live-preview').classList.remove('hidden'); inboxStatus('Review the formal version before sending.');
  } catch (error) {
    if (started !== epoch || currentRevision !== revision) return;
    if (!connected()) {
      $('live-formal').value = text; $('live-preview').classList.remove('hidden');
      inboxStatus('AI unavailable. Edit and review the formal version manually before sending.');
    } else inboxStatus(error.message);
  }
  finally { polishing = false; for (const id of ['live-review', 'live-send']) $(id).disabled = !selected || sending; }
}
$('live-cancel').addEventListener('click', () => { invalidatePreview(); inboxStatus('Draft kept.'); });
$('live-send').addEventListener('click', async () => {
  if (sending || polishing || !selected) return;
  if (connected() && aiRevision !== revision) { await polishDraft(); return; }
  const formal = $('live-formal').value.trim();
  if (!formal) { inboxStatus('Write the formal version first.'); return; }
  const contact = selected, started = epoch, currentRevision = revision;
  const dual = connected(), original = $('live-draft').value;
  pendingMessageId ||= crypto.randomUUID();
  const clientMessageId = pendingMessageId;
  sending = true;
  for (const id of ['live-send', 'live-formal', 'live-draft', 'live-review', 'live-cancel']) $(id).disabled = true;
  inboxStatus('Sending formal message…');
  try {
    const delivery = await deliverMessage({
      connected: dual, original, formal, aiReady: aiRevision === currentRevision,
      sendFormal: value => call('send', { recipientId: contact.id, formal: value, clientMessageId }),
      sendOriginal: value => {
        if (started !== epoch || selected?.id !== contact.id || !connected()) throw new Error('Informal connection closed.');
        return peerUI.send(value, clientMessageId);
      },
    });
    if (started !== epoch) return;
    if (currentRevision === revision && selected?.id === contact.id) { $('live-draft').value = ''; invalidatePreview(); }
    inboxStatus(delivery.privateError
      ? `Formal delivered. Original was NOT sent: ${delivery.privateError}`
      : delivery.informal ? `Formal delivered to ${contact.display_name}; original sent over P2P.`
      : `Formal delivered to ${contact.display_name}. No informal message sent.`);
    threadFingerprint = ''; await sync(true);
    $('live-messages').scrollTop = $('live-messages').scrollHeight;
  } catch (error) { if (started === epoch) inboxStatus(`${error.message} Retry safely; the same message won’t be duplicated.`); }
  finally {
    sending = false;
    for (const id of ['live-send', 'live-formal', 'live-draft', 'live-review', 'live-cancel']) $(id).disabled = !selected;
  }
});
document.querySelector('[data-tab="messaging"]').addEventListener('click', () => sync(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(true); peerUI.wake(); } });
window.addEventListener('online', () => { sync(true); peerUI.wake(); });
setInterval(() => { if (!document.hidden && !$('messaging').classList.contains('hidden')) sync(); }, 3000);
// Availability only: project URL and API keys never need to reach the browser.
fetch(`${location.protocol === 'chrome-extension:' ? (await import('./config.js')).EXTENSION_API : location.origin}/api/health`)
  .then(response => response.json()).then(async health => {
    enabled = health.messagingEnabled === true;
    $('account-submit').disabled = !enabled;
    if (!enabled) { accountStatus('Messaging setup pending. Try Chat demo, or ask the project owner to connect Supabase.'); return; }
    if (session) {
      try { await openInbox(); } catch (error) { clearAccount(error.message); }
    } else accountStatus(confirmationNotice || 'Sign in, or create an account to get your username.');
  }).catch(() => { $('account-submit').disabled = true; accountStatus('Account service unavailable. Please refresh.'); });
