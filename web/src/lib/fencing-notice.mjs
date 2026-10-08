/**
 * fencing-notice.mjs — recognise the fencing notices cli-fencing.mjs emits.
 *
 * Split out because the worker card is a client component, and cli-fencing.mjs
 * imports node:path: anything a "use client" file needs from it lives here, with
 * no node: import, and cli-fencing.mjs builds its notices from the same markers.
 */

/** Stable fragments of the two notices, so the UI can spot either without re-deriving a sentence. */
export const UNFENCED_MARKER = "cannot be permission-restricted";
export const PARTIAL_MARKER = "is only partly restricted";

/**
 * Does this run-step label carry a fencing notice?
 *
 * Exported for the worker card, which renders a sticky warning rather than letting
 * the notice scroll out of its single latest-step slot. A predicate rather than a
 * marker constant because there are now two notice shapes, and a detector that
 * knows only one goes quietly stale the day the second is added.
 *
 * @param {string|undefined} label
 * @returns {boolean}
 */
export function isFencingNotice(label) {
  return typeof label === "string" && (label.includes(UNFENCED_MARKER) || label.includes(PARTIAL_MARKER));
}
