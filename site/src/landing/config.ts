/** D86-3 (spike W86.0: below ~16 700 particles the page is over budget and re-forming liquid goes hollow). */
export const BODY_OPTIONS = { particles: 18000, maxElements: 48, renderer: "auto" } as const;
/** D86-3: the five chapter 3 and 7 container instances, paused off-screen. */
export const POOL_OPTIONS = { particles: 1000, maxElements: 2, renderer: "auto" } as const;
/** D86-4. */
export const ARRIVAL_STRENGTH = 0.8;
export const HINT_STRENGTH = 0.5;
export const HINT_DELAY_MS = 4000;
export const STOPPED_MESSAGE = "The liquid stopped; the page works as usual.";
