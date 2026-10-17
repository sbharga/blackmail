import { describe, it, expect, vi } from 'vitest';
import { encryptMessage, decryptMessage } from '../p2p';
import { createPeerSession } from '../../../extension/p2p-session.js';

describe('provided P2P encryption', () => {
  it('round trips Unicode, randomizes IVs and rejects tampering', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
    const first = await encryptMessage('informal 😭', key);
    const second = await encryptMessage('informal 😭', key);
    expect(await decryptMessage(first, key)).toBe('informal 😭');
    expect(first.iv).not.toEqual(second.iv);
    first.ciphertext[0] ^= 1;
    await expect(decryptMessage(first, key)).rejects.toThrow();
  });
  it('rejects a missing or closed recipient channel', async () => {
    const { send_peer_too_peer } = await import('../p2p');
    await expect(send_peer_too_peer('hello', 'missing')).rejects.toThrow('handshake');
  });
});

function harness() {
  let receive;
  const send = vi.fn(async () => {});
  const transport = {
    onPeerMessage: callback => { receive = callback; },
    createManualOffer: async () => ({ offerToken: 'offer', ticketId: 'ticket', waitForConnect: new Promise(() => {}) }),
    acceptOfferAndCreateAnswer: async () => ({ answerToken: 'answer', recipientId: 'peer-b' }),
    finalizeManualHandshake: async () => 'peer-b', send_peer_too_peer: send,
  };
  let clock = 1000;
  const session = createPeerSession(transport, () => {}, () => clock);
  return { session, transport, send, receive: (...args) => receive(...args), advance: ms => { clock += ms; } };
}
async function connect(h) {
  h.session.reset('bob'); await h.session.offer(); await h.session.finalize('answer');
  const ping = JSON.parse(h.send.mock.calls.at(-1)[0]);
  h.receive(JSON.stringify({ blackmail: 1, type: 'pong', nonce: ping.nonce, session: 'remote-session' }), 'peer-b');
}
describe('informal messaging integration', () => {
  it('accepts pairing control after an authenticated ping, before the responder pong', async () => {
    const h=harness();h.session.reset('alice');await h.session.answer('offer');
    const controls=[];h.session.onControl(value=>controls.push(value));
    h.receive(JSON.stringify({blackmail:1,type:'ping',nonce:'probe',session:'remote-session'}),'peer-b');
    h.receive(JSON.stringify({blackmail:1,type:'control',value:{kind:'remember'},session:'remote-session'}),'peer-b');
    expect(controls).toEqual([{kind:'remember'}]);
    await h.session.control({kind:'remember-ack'});
    expect(h.session.snapshot().state).toBe('Handshaking');
  });
  it('requires an acknowledged channel, receives only its peer, and clears on account/contact change', async () => {
    const h = harness(); h.session.reset('bob');
    await expect(h.session.send('hi')).rejects.toThrow('handshake');
    await connect(h); expect(h.session.snapshot().state).toBe('Connected');
    await h.session.send('private draft');
    expect(JSON.parse(h.send.mock.calls.at(-1)[0]).text).toBe('private draft');
    const packet = JSON.stringify({ blackmail: 1, type: 'message', session: 'remote-session', text: '<b>private reply</b>' });
    h.receive(packet, 'unrelated'); expect(h.session.snapshot().messages).toHaveLength(1);
    h.receive(packet, 'peer-b'); expect(h.session.snapshot().messages).toHaveLength(2);
    h.session.reset(null); h.receive(packet, 'peer-b');
    expect(h.session.snapshot()).toMatchObject({ state: 'Disconnected', messages: [], peer: null });
  });
  it('does not mark the responder Connected merely for generating an answer', async () => {
    const h = harness(); h.session.reset('alice');
    expect(await h.session.answer('offer')).toBe('answer');
    expect(h.session.snapshot().state).toBe('Handshaking');
    await expect(h.session.send('hi')).rejects.toThrow('handshake');
    h.advance(120001); await h.session.tick();
    expect(h.session.snapshot().state).toBe('Disconnected');
  });
  it('handles channel failure and ignores stale async handshakes after signout', async () => {
    const h = harness(); await connect(h);
    h.send.mockRejectedValueOnce(new Error('channel closed'));
    await expect(h.session.send('unsent')).rejects.toThrow('closed');
    expect(h.session.snapshot().messages).toHaveLength(0);
    expect(h.session.snapshot().state).toBe('Disconnected');
    let resolve; h.transport.createManualOffer = () => new Promise(r => { resolve = r; });
    const pending = h.session.offer(); h.session.reset(null);
    resolve({ offerToken: 'stale', ticketId: 'stale', waitForConnect: new Promise(() => {}) });
    await expect(pending).rejects.toThrow('changed');
    expect(h.session.snapshot().peer).toBeNull();
  });
});
