/**
 * Holding your breath behind a scope. Standing still with a magnifying scope and Shift held steadies the crosshair, tightens
 * the shot and flattens the bullet's path, for a few seconds; running out leaves you winded until some breath is back.
 */
/** Seconds of held breath, and how fast it comes back (seconds regained per second). */
export const BREATH_SECONDS = 4.5;
export const BREATH_RECOVER = 1.1;
/** After running out, the breath has to refill to this much before it can be held again. */
export const BREATH_RESUME = 1.8;
/** Held breath multiplies a shot's spread by this and its muzzle velocity by that (a flatter, straighter path). */
export const BREATH_SPREAD = 0.1;
export const BREATH_VELOCITY = 1.7;
