/**
 * Rendering weights honestly.
 *
 * The previous formatter divided by 1e18 and kept two decimal places, so
 * mainnet proposal 2's real tally of 900 / 100 base units rendered as
 * "for 0.00 · against 0.00 · abstain 0.00 · passed". That reads as either a
 * broken page or a fabricated result, and it hid the one detail that gives the
 * game away: those numbers are raw base units, roughly 9e-16 STRK, so no ballot
 * produced them.
 *
 * A value too small to show at STRK scale is now shown at the scale it exists
 * at, and flagged.
 */

const WEI = 10n ** 18n;

/** Below this, a STRK-scale rendering is all zeroes and tells the reader nothing. */
const DUST_THRESHOLD = 10n ** 12n;

export interface FormattedWeight {
  /** Always safe to show: falls back to base units when STRK scale would round to zero. */
  readonly display: string;
  /** The STRK-scale rendering, whether or not it is meaningful. */
  readonly strk: string;
  readonly base: string;
  /** Non-zero but too small to render at STRK scale. */
  readonly isDust: boolean;
  readonly isZero: boolean;
}

export function formatWeight(amount: bigint): FormattedWeight {
  const whole = amount / WEI;
  // Four places, then trailing zeros trimmed: a round 2 STRK reads better as
  // "2 STRK" than "2.0000 STRK", and a small weight keeps the precision it
  // needs. Never trim the significant digits, only the padding.
  const frac = (amount % WEI).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  const strk = frac ? `${whole}.${frac}` : `${whole}`;
  const isZero = amount === 0n;
  const isDust = !isZero && amount < DUST_THRESHOLD;

  return {
    display: isDust ? `${amount} base units` : `${strk} STRK`,
    strk,
    base: amount.toString(),
    isDust,
    isZero,
  };
}

/**
 * Format a group of weights on one scale.
 *
 * Formatting each value independently produced rows like
 * "for 900 base units · against 100 base units · abstain 0.0000 STRK" — three
 * numbers, two units, in a single line the reader is meant to compare. If any
 * value in the group is too small for STRK scale, the whole group drops to base
 * units so the comparison is between like and like.
 */
export function formatWeightGroup(amounts: readonly bigint[]): FormattedWeight[] {
  const formatted = amounts.map(formatWeight);
  const anyDust = formatted.some((f) => f.isDust);
  if (!anyDust) return formatted;
  return formatted.map((f) => ({ ...f, display: `${f.base} base units` }));
}
