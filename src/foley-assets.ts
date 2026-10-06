const base = `${import.meta.env?.BASE_URL ?? '/'}assets/coverage/`;
export const FOLEY_ASSETS: Record<string, string> = Object.fromEntries([
  'step-a', 'step-b', 'step-metal', 'step-grass', 'step-concrete', 'cloth', 'heal', 'hatch', 'throw', 'melee',
  'impact', 'explosion', 'fire-sfx', 'hum', 'hiss', 'reload', 'reload-pistol', 'reload-shotgun', 'engine', 'wind', 'drip', 'breath',
].map(key => [key, `${base}${key}.ogg`]));
