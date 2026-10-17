// Formal commits first. A private-channel failure never retries/duplicates the formal write.
export async function deliverMessage({ connected, original, formal, aiReady, sendFormal, sendOriginal }) {
  if (connected && !aiReady) throw new Error('Use Nebius to prepare the formal version before sending both channels.');
  await sendFormal(formal);
  if (!connected) return { informal: false };
  try { await sendOriginal(original); return { informal: true }; }
  catch (error) { return { informal: false, privateError: error.message }; }
}
