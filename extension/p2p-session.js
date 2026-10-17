// Application state around the supplied utility; no backend transport or storage.
export function createPeerSession(transport, changed = () => {}, now = Date.now) {
  let generation = 0, contact = null, peer = null, ticket = null;
  let state = 'Disconnected', lastSeen = 0, probe = null, remoteSession = null, deadline = 0;
  let localSession = crypto.randomUUID(), messages = [];
  let controlHandler = () => {};
  const emit = () => changed();
  const snapshot = () => ({ contact, peer, state, messages: [...messages] });
  const reset = target => {
    generation++; contact = target; peer = ticket = remoteSession = probe = null;
    localSession = crypto.randomUUID(); messages = []; lastSeen = 0; state = 'Disconnected'; emit();
  };
  const envelope = (type, fields = {}) => JSON.stringify({ blackmail: 1, type, session: localSession, ...fields });
  async function tick() {
    const run = generation;
    if (state === 'Handshaking' && now() > deadline) { reset(contact); return; }
    if (!peer) return;
    if (lastSeen && now() - lastSeen > 20000) { state = 'Disconnected'; emit(); }
    probe = crypto.randomUUID();
    try { await transport.send_peer_too_peer(envelope('ping', { nonce: probe }), peer); }
    catch { if (run === generation && state === 'Connected') { state = 'Disconnected'; emit(); } }
  }
  transport.onPeerMessage((raw, sender) => {
    if (!contact || sender !== peer) return;
    let packet; try { packet = JSON.parse(raw); } catch { return; }
    if (packet.blackmail !== 1 || typeof packet.session !== 'string') return;
    if (packet.type === 'ping' && typeof packet.nonce === 'string') {
      remoteSession = packet.session;
      transport.send_peer_too_peer(envelope('pong', { nonce: packet.nonce }), peer).catch(() => {});
      return;
    }
    if (packet.type === 'pong' && packet.nonce === probe) {
      remoteSession = packet.session; lastSeen = now(); state = 'Connected'; emit(); return;
    }
    if (packet.type === 'control' && ['Connected', 'Handshaking'].includes(state) && packet.session === remoteSession) {
      controlHandler(packet.value); return;
    }
    if (packet.type !== 'message' || state !== 'Connected' || packet.session !== remoteSession ||
        typeof packet.text !== 'string' || !packet.text.trim() || packet.text.length > 3000) return;
    const messageId = typeof packet.formalId === 'string' && /^[a-f0-9-]{36}$/i.test(packet.formalId) ? packet.formalId : null;
    messages.push({ text: packet.text, mine: false, createdAt: now(), messageId }); messages = messages.slice(-100); emit();
  });
  return {
    snapshot, reset, tick,
    onControl(handler) { controlHandler = handler; },
    async control(value) {
      if (!peer || !remoteSession || !['Connected', 'Handshaking'].includes(state)) throw new Error('Peer is offline.');
      await transport.send_peer_too_peer(envelope('control', { value }), peer);
    },
    async offer() {
      if (!contact) throw new Error('Select a contact first.');
      const target = contact; reset(target); const run = generation; state = 'Handshaking'; deadline = now() + 120000; emit();
      try {
        const result = await transport.createManualOffer();
        if (run !== generation) throw new Error('Conversation changed. Start a new connection.');
        ticket = result.ticketId;
        result.waitForConnect.then(id => { if (run === generation) { peer = id; tick(); } }).catch(() => {});
        return result.offerToken;
      } catch (error) { if (run === generation) { state = 'Disconnected'; emit(); } throw error; }
    },
    async answer(token) {
      if (!contact) throw new Error('Select a contact first.');
      const target = contact; reset(target); const run = generation; state = 'Handshaking'; deadline = now() + 120000; emit();
      try {
        const result = await transport.acceptOfferAndCreateAnswer(token);
        if (run !== generation) throw new Error('Conversation changed. Start a new connection.');
        peer = result.recipientId; tick(); return result.answerToken;
      } catch (error) { if (run === generation) { state = 'Disconnected'; emit(); } throw error; }
    },
    async finalize(token) {
      if (!ticket) throw new Error('Create an offer first.');
      const run = generation; const pending = ticket; ticket = null;
      try {
        const id = await transport.finalizeManualHandshake(pending, token);
        if (run !== generation) return;
        peer = id; await tick();
      } catch (error) { if (run === generation) { state = 'Disconnected'; emit(); } throw error; }
    },
    async send(text, messageId = null) {
      if (!peer || state !== 'Connected') throw new Error('Complete the P2P handshake with this contact first.');
      if (!text.trim() || text.length > 3000) throw new Error('Write an informal message of 1–3,000 characters.');
      const run = generation;
      try { await transport.send_peer_too_peer(envelope('message', { text, formalId: messageId }), peer); }
      catch (error) { if (run === generation) { state = 'Disconnected'; emit(); } throw error; }
      if (run === generation) { messages.push({ text, mine: true, createdAt: now(), messageId }); messages = messages.slice(-100); emit(); }
    },
  };
}
