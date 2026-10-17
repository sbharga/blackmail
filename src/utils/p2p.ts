/**
 * Structure encoded into the Base64 copy-paste connection token.
 */
interface HandshakeToken {
  sdp: RTCSessionDescriptionInit;
  publicKeyJwk: JsonWebKey;
  peerId: string;
}

/**
 * Structure transmitted over the RTCDataChannel.
 */
export interface EncryptedPacket {
  iv: number[];
  ciphertext: number[];
}

/**
 * Pooled session state for an active peer.
 */
interface PeerSession {
  peerId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  aesKey: CryptoKey;
}

// Module-level connection pool and identity state
const connectionPool = new Map<string, PeerSession>();
const pendingOffers = new Map<
  string,
  {
    pc: RTCPeerConnection;
    channel: RTCDataChannel;
    privateKey: CryptoKey;
    resolve: (id: string) => void;
  }
>();

let localKeyPair: CryptoKeyPair | null = null;
let localPeerId: string | null = null;
let messageHandler: ((plaintext: string, senderPeerId: string) => void) | null = null;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

/**
 * Dedicated function to encrypt a plaintext string using an AES-256-GCM CryptoKey.
 */
export async function encryptMessage(
  rawMessage: string,
  aesKey: CryptoKey
): Promise<EncryptedPacket> {
  // Generate a random 12-byte (96-bit) initialization vector (IV) for every message
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encodedPayload = new TextEncoder().encode(rawMessage);

  const ciphertextBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encodedPayload
  );

  return {
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertextBuffer)),
  };
}

/**
 * Dedicated function to decrypt an EncryptedPacket using an AES-256-GCM CryptoKey.
 */
export async function decryptMessage(
  packet: EncryptedPacket,
  aesKey: CryptoKey
): Promise<string> {
  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(packet.iv) },
    aesKey,
    new Uint8Array(packet.ciphertext)
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Registers the callback for incoming decrypted messages.
 */
export function onPeerMessage(
  callback: (plaintext: string, senderPeerId: string) => void
): void {
  messageHandler = callback;
}

/**
 * Sends an AES-256-GCM encrypted message over a cached WebRTC DataChannel.
 */
export async function send_peer_too_peer(
  raw_message: string,
  recipient: string
): Promise<void> {
  const session = connectionPool.get(recipient);

  if (!session || session.channel.readyState !== 'open') {
    connectionPool.delete(recipient);
    throw new Error(
      `No open P2P DataChannel found for recipient "${recipient}". Complete the manual handshake first.`
    );
  }

  const packet = await encryptMessage(raw_message, session.aesKey);
  session.channel.send(JSON.stringify(packet));
}

// ============================================================================
// MANUAL HANDSHAKE HELPERS (3-Step Copy-Paste Flow)
// ============================================================================

export async function createManualOffer(): Promise<{
  offerToken: string;
  ticketId: string;
  waitForConnect: Promise<string>;
}> {
  const { keyPair, publicKeyJwk, peerId } = await ensureLocalIdentity();
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const channel = pc.createDataChannel('e2ee_p2p', { ordered: true });

  const ticketId = globalThis.crypto.randomUUID();
  let resolveConnection!: (recipientId: string) => void;
  const waitForConnect = new Promise<string>((resolve) => {
    resolveConnection = resolve;
  });

  // Store keyPair.privateKey directly on the ticket so Step 3 always uses
  // the exact private key that created the offer.
  pendingOffers.set(ticketId, {
    pc,
    channel,
    privateKey: keyPair.privateKey,
    resolve: resolveConnection,
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);

  const tokenPayload: HandshakeToken = {
    sdp: pc.localDescription!,
    publicKeyJwk,
    peerId,
  };

  return {
    offerToken: encodeToken(tokenPayload),
    ticketId,
    waitForConnect,
  };
}

export async function acceptOfferAndCreateAnswer(
  offerToken: string
): Promise<{ answerToken: string; recipientId: string }> {
  const { publicKeyJwk, peerId: myPeerId, keyPair } = await ensureLocalIdentity();
  const remoteOffer = decodeToken(offerToken);

  const sharedAesKey = await deriveSharedAesKey(
    keyPair.privateKey,
    remoteOffer.publicKeyJwk
  );

  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.ondatachannel = (event) => {
    const channel = event.channel;
    bindDataChannel(remoteOffer.peerId, pc, channel, sharedAesKey);
  };

  await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer.sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGatheringComplete(pc);

  const answerPayload: HandshakeToken = {
    sdp: pc.localDescription!,
    publicKeyJwk,
    peerId: myPeerId,
  };

  return {
    answerToken: encodeToken(answerPayload),
    recipientId: remoteOffer.peerId,
  };
}

export async function finalizeManualHandshake(
  ticketId: string,
  answerToken: string
): Promise<string> {
  const pending = pendingOffers.get(ticketId);
  if (!pending) {
    throw new Error(`Invalid or expired handshake ticket: ${ticketId}`);
  }
  pendingOffers.delete(ticketId);

  const remoteAnswer = decodeToken(answerToken);

  // Derive the shared AES key using the initiator's saved privateKey
  const sharedAesKey = await deriveSharedAesKey(
    pending.privateKey,
    remoteAnswer.publicKeyJwk
  );

  const { pc, channel, resolve } = pending;

  const openPromise = new Promise<string>((res, rej) => {
    const timeout = setTimeout(() => rej(new Error('WebRTC connection timed out')), 15000);
    channel.onopen = () => {
      clearTimeout(timeout);
      bindDataChannel(remoteAnswer.peerId, pc, channel, sharedAesKey);
      resolve(remoteAnswer.peerId);
      res(remoteAnswer.peerId);
    };
  });

  await pc.setRemoteDescription(new RTCSessionDescription(remoteAnswer.sdp));
  return openPromise;
}

// ============================================================================
// INTERNAL CRYPTO & WEBRTC HELPERS
// ============================================================================

function bindDataChannel(
  recipientId: string,
  pc: RTCPeerConnection,
  channel: RTCDataChannel,
  aesKey: CryptoKey
): void {
  connectionPool.set(recipientId, { peerId: recipientId, pc, channel, aesKey });

  channel.onmessage = async (event) => {
    if (!messageHandler) return;
    try {
      const packet: EncryptedPacket = JSON.parse(event.data);
      const plaintext = await decryptMessage(packet, aesKey);
      messageHandler(plaintext, recipientId);
    } catch (err) {
      console.error(`Decryption failed from peer ${recipientId}:`, err);
    }
  };

  channel.onclose = () => {
    connectionPool.delete(recipientId);
  };
}

async function ensureLocalIdentity(): Promise<{
  keyPair: CryptoKeyPair;
  publicKeyJwk: JsonWebKey;
  peerId: string;
}> {
  if (!localKeyPair) {
    localKeyPair = await globalThis.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey']
    );
  }

  const publicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', localKeyPair.publicKey);

  if (!localPeerId) {
    const rawKeyBytes = new TextEncoder().encode(`${publicKeyJwk.x}.${publicKeyJwk.y}`);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', rawKeyBytes);
    localPeerId = Array.from(new Uint8Array(hashBuffer))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  return { keyPair: localKeyPair, publicKeyJwk, peerId: localPeerId };
}

async function deriveSharedAesKey(
  privateKey: CryptoKey,
  remotePublicKeyJwk: JsonWebKey
): Promise<CryptoKey> {
  const remotePublicKey = await globalThis.crypto.subtle.importKey(
    'jwk',
    remotePublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  return globalThis.crypto.subtle.deriveKey(
    { name: 'ECDH', public: remotePublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', checkState);
      resolve();
    }, 4000);

    function checkState() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }
    }

    pc.addEventListener('icegatheringstatechange', checkState);
  });
}

function encodeToken(payload: HandshakeToken): string {
  return btoa(JSON.stringify(payload));
}

function decodeToken(token: string): HandshakeToken {
  return JSON.parse(atob(token.trim()));
}

export function _resetP2PStateForTesting(clearConnections = true): void {
  localKeyPair = null;
  localPeerId = null;
  if (clearConnections) {
    connectionPool.clear();
    pendingOffers.clear();
    messageHandler = null;
  }
}
