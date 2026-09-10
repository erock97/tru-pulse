/** Current API counts do not establish complete coverage of Zillow messages.
 * This hold is deliberate, not a setting that retries or starts collection.
 * Remove only after a reviewed evidence contract supports the decisions.
 */
export const CONTACT_DECISION_HOLD = {
 state: 'held',
 reason: 'Communication coverage is incomplete. Contact-based strikes, resolutions and pause recommendations are on hold.',
} as const;

/** Never promote an unsupported negative claim, including one cached before retirement. */
export function observedContactFlag(flag:string|null|undefined):string {
 return !flag || flag==='zero_contact' ? 'unknown' : flag;
}
