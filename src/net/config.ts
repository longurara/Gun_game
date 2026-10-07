/**
 * Lobby and WebRTC signaling use Supabase Realtime broadcast (no tables), through the project's
 * *publishable* key, which is meant to be public. Override with VITE_SUPABASE_URL / VITE_SUPABASE_KEY in `.env.local`
 * to point at another project. Never put a service-role key in the browser.
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const SUPABASE = {
  url: env.VITE_SUPABASE_URL || 'https://rrjknbkpvbwrqiclrloe.supabase.co',
  key: env.VITE_SUPABASE_KEY || 'sb_publishable_woR3fw3Tz9n8kyGxEdlScA_EZ7YLBfj',
};

/** Optional TURN credentials are visible to players: use short-lived credentials for a public deployment. */
export function rtcConfiguration(raw = env.VITE_WEBRTC_ICE_SERVERS): RTCConfiguration {
  if (!raw) return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const servers: unknown = JSON.parse(raw);
  if (!Array.isArray(servers) || !servers.every(server => server &&
    (typeof server.urls === 'string' || Array.isArray(server.urls) && server.urls.every((url: unknown) => typeof url === 'string')))) {
    throw new Error('VITE_WEBRTC_ICE_SERVERS phải là mảng RTCIceServer hợp lệ.');
  }
  return { iceServers: servers };
}
