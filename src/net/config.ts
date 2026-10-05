/**
 * Where multiplayer rooms live. Rooms use Supabase Realtime broadcast only (no tables), through the project's
 * *publishable* key, which is meant to be public. Override with VITE_SUPABASE_URL / VITE_SUPABASE_KEY in `.env.local`
 * to point at another project. Never put a service-role key in the browser.
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const SUPABASE = {
  url: env.VITE_SUPABASE_URL || 'https://rrjknbkpvbwrqiclrloe.supabase.co',
  key: env.VITE_SUPABASE_KEY || 'sb_publishable_woR3fw3Tz9n8kyGxEdlScA_EZ7YLBfj',
};
