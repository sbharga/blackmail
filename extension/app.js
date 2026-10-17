import { EXTENSION_API } from './config.js';
const API = location.protocol === 'chrome-extension:' ? EXTENSION_API : location.origin;
const $ = id => document.getElementById(id);
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = str => Uint8Array.from(str.match(/../g), x => parseInt(x, 16));
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
let activeRead = null;
let activeCreated = null;
let polling = false;
let creating = false;
let serverOffset = 0;
const serverNow = () => Date.now() + serverOffset;
export { api, serverNow };
let history;
try { history = JSON.parse(localStorage.getItem('blackmail.sent') || '[]'); if (!Array.isArray(history)) history = []; } catch { history = []; }
const status = text => { $('status').textContent = text; };
const save = () => {
  history = history.slice(0, 50);
  try { localStorage.setItem('blackmail.sent', JSON.stringify(history)); } catch { status('Browser history unavailable. Keep this tab open to revoke your pass.'); }
};
async function api(path, body, method = 'POST', token) {
  let response;
  try { response = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000), cache: 'no-store' }); }
  catch { throw new Error('BlackMail server unavailable. Check your connection or local server.'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Preview access required. Open this deployment in a browser signed into Vercel, or use the production app.');
  const result = await response.json();
  if (Number.isFinite(result.serverTime)) serverOffset = result.serverTime - Date.now();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { status: response.status });
  return result;
}
function tab(name) {
  document.querySelectorAll('.panel').forEach(el => el.classList.toggle('hidden', el.id !== name));
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === name));
  if (name !== 'receive') closeRead();
  status('');
  if (name === 'sent') renderHistory();
}
document.querySelectorAll('.tab').forEach(el => el.addEventListener('click', () => tab(el.dataset.tab)));
function closeRead(message = '') {
  activeRead = null;
  $('plaintext').textContent = '';
  $('opened').classList.add('hidden');
  if (message) status(message);
}
function remaining(expiresAt) { return `${Math.max(0, Math.ceil((expiresAt - serverNow()) / 1000))}s left`; }
async function copy(text) {
  if (!text.trim()) throw new Error('Nothing to copy yet.');
  try { await navigator.clipboard.writeText(text); status('Copied. Paste into your messaging app.'); }
  catch { throw new Error('Clipboard unavailable. Select and copy the text manually.'); }
}
function action(id, fn) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    try { await fn(); } catch (error) { status(error.message); } finally { $(id).disabled = false; }
  });
}
$('original').addEventListener('input', () => { $('count').textContent = `${$('original').value.length.toLocaleString()} / 12,000`; });
action('rewrite', async () => {
  const draft = $('original').value;
  if (!draft.trim()) throw new Error('Write an original message first.');
  status('Polishing your draft…');
  const result = await api('/api/rewrite', { text: draft });
  if ($('original').value !== draft) { status('Draft changed during rewriting. Try again.'); return; }
  $('formal').value = result.text;
  status('Review the formal version before sharing.');
});
action('copy-formal', () => copy($('formal').value));
action('seal', async () => {
  if (creating) return;
  const original = $('original').value;
  const formal = $('formal').value;
  if (!original.trim() || !formal.trim()) throw new Error('Write both versions before creating a pass.');
  creating = true;
  try {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(original)));
    const access = hex(crypto.getRandomValues(new Uint8Array(32)));
    const rawKey = hex(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
    const item = await api('/api/messages', { ciphertext: b64(ciphertext), iv: b64(iv), access });
    const pass = `bm1.${item.id}.${access}.${rawKey}`;
    // Keep only formal text and revocation capability. No original or decryption key in history.
    history.unshift({ ...item, formal, createdAt: Date.now(), revoked: false });
    save();
    activeCreated = { pass, expiresAt: item.expiresAt };
    $('share-pass').value = pass;
    $('created-time').textContent = remaining(item.expiresAt);
    $('created').classList.remove('hidden');
    status('Pass created. Formal message has NOT been sent. Copy and send it through your app.');
  } finally { creating = false; }
});
action('copy-pass', async () => {
  if (!activeCreated || activeCreated.expiresAt <= serverNow()) throw new Error('Pass expired. Create a new one.');
  await copy(activeCreated.pass);
});
action('try-pass', () => { tab('receive'); $('incoming').value = activeCreated?.pass || ''; });
action('unlock', async () => {
  closeRead();
  const pass = $('incoming').value.trim();
  const match = /^bm1\.([a-f0-9]{32})\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(pass);
  if (!match) throw new Error('Invalid pass. Paste the complete bm1… code.');
  const [, id, access, secret] = match;
  const result = await api(`/api/messages/${id}/open`, { access });
  const key = await crypto.subtle.importKey('raw', unhex(secret), 'AES-GCM', false, ['decrypt']);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(result.iv) }, key, unb64(result.ciphertext)); }
  catch { throw new Error('Could not decrypt. Check the complete pass.'); }
  if (result.expiresAt <= serverNow()) throw new Error('Pass expired.');
  activeRead = { id, access, expiresAt: result.expiresAt };
  $('plaintext').textContent = new TextDecoder().decode(plain);
  $('read-time').textContent = remaining(result.expiresAt);
  $('opened').classList.remove('hidden');
  $('incoming').value = '';
  status('Original unlocked. This view clears on expiry or revocation check.');
});
action('close-original', () => closeRead('Original closed.'));
function renderHistory() {
  const list = $('history');
  list.replaceChildren();
  if (!history.length) { const p = document.createElement('p'); p.textContent = 'No passes yet. Write your first two-sided message.'; list.append(p); }
  for (const item of history) {
    const card = document.createElement('article'); card.className = 'history-item';
    const row = document.createElement('div'); row.className = 'result-head';
    const label = document.createElement('small');
    label.textContent = `${new Date(item.createdAt).toLocaleString()} · ${item.revoked ? 'Revoked' : item.expiresAt <= serverNow() ? 'Expired' : remaining(item.expiresAt)}`;
    const controls = document.createElement('div');
    const copyButton = document.createElement('button'); copyButton.className = 'secondary'; copyButton.textContent = 'Copy formal';
    copyButton.addEventListener('click', () => copy(item.formal).catch(error => status(error.message)));
    controls.append(copyButton);
    if (!item.revoked && item.expiresAt > serverNow()) {
      const revoke = document.createElement('button'); revoke.className = 'secondary'; revoke.textContent = 'Revoke original';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try {
          await api(`/api/messages/${item.id}`, { owner: item.owner }, 'DELETE');
          item.revoked = true; save();
          if (activeCreated?.pass.includes(`.${item.id}.`)) { activeCreated = null; $('share-pass').value = ''; $('created').classList.add('hidden'); }
          status('Original revoked. Formal copies are unaffected.'); renderHistory();
        } catch (error) { status(error.message); revoke.disabled = false; }
      });
      controls.append(revoke);
    }
    row.append(label, controls);
    const text = document.createElement('p'); text.textContent = item.formal;
    card.append(row, text); list.append(card);
  }
}
setInterval(() => {
  if (activeCreated) {
    $('created-time').textContent = remaining(activeCreated.expiresAt);
    if (activeCreated.expiresAt <= serverNow()) { activeCreated = null; $('share-pass').value = ''; $('created-time').textContent = 'Expired'; }
  }
  if (activeRead) {
    $('read-time').textContent = remaining(activeRead.expiresAt);
    if (activeRead.expiresAt <= serverNow()) closeRead('Pass expired. Original removed from this view.');
  }
}, 500);
setInterval(async () => {
  if (!activeRead || polling) return;
  polling = true;
  const current = activeRead;
  try { await api(`/api/messages/${current.id}/open`, { access: current.access }); }
  catch { if (activeRead === current) closeRead('Original unavailable. Pass revoked, expired, or server offline.'); }
  finally { polling = false; }
}, 3000);
document.addEventListener('visibilitychange', () => { if (document.hidden) closeRead(); });
fetch(`${API}/api/health`).then(r => r.json()).then(data => {
  if (Number.isFinite(data.serverTime)) serverOffset = data.serverTime - Date.now();
  if (!data.ok) { $('connection').textContent = '○ Connect Redis in Vercel to enable passes'; return; }
  $('connection').textContent = `● ${data.storage === 'shared' ? 'Shared' : 'Local'} vault connected · ${data.aiEnabled ? 'AI ready' : 'manual mode'}`;
}).catch(() => { $('connection').textContent = '○ Server offline'; });
