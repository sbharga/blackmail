// Explicitly authorized demo pair. IDs are public; no reconnect secret ships to clients.
export const DEMO_PAIR_IDS = ['aa0c2b9b-632c-49ab-9f71-54a3d35af2ee', '62ebf210-0e15-4686-b32a-d105a8ba0381'];
export function demoPeerFor(userId) {
  return DEMO_PAIR_IDS.includes(userId) ? DEMO_PAIR_IDS.find(id => id !== userId) : null;
}
