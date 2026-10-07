const utf8 = new TextEncoder();
/** Prove possession of the ticket without broadcasting the ticket itself to the room. */
export async function reconnectProof(ticket: string, from: string, to: string, attempt: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8.encode(ticket), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(JSON.stringify([from, to, attempt]))));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifyReconnectProof(ticket: string, from: string, to: string, attempt: number, proof: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(proof)) return false;
  const expected = await reconnectProof(ticket, from, to, attempt);
  let different = 0;
  for (let i = 0; i < expected.length; i++) different |= expected.charCodeAt(i) ^ proof.charCodeAt(i);
  return different === 0;
}
