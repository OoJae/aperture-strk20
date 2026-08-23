/**
 * Parsing token amounts without a float in the money path.
 *
 * `BigInt(Math.round(Number("0.1") * 1e18))` happens to give the right answer,
 * which is the problem: it is right by luck of rounding rather than by
 * construction. `Number("9007199254740993")` is not that integer at all, and a
 * decimal with enough places quietly becomes a different amount than the one
 * typed. This is the value that gets escrowed and baked into a commitment, so
 * "usually correct" is the wrong standard.
 */

export class AmountParseError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "AmountParseError";
  }
}

export function parseTokenAmount(input: string, decimals = 18): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new AmountParseError(
      `Amount must be a non-negative decimal number, digits only (got "${input}"). ` +
        `Exponent notation and signs are rejected deliberately.`,
    );
  }

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new AmountParseError(
      `Amount has ${fraction.length} decimal places but the token has ${decimals}. ` +
        `Truncating here would round someone's money.`,
    );
  }

  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export const U128_MAX = 2n ** 128n - 1n;
export const U64_MAX = 2n ** 64n - 1n;

/**
 * Bound a value before it becomes Cairo calldata.
 *
 * Without this, a weight past u128 produces a felt the deserializer rejects —
 * on-chain, after gas, with a message naming nothing.
 */
export function assertFits(name: string, value: bigint, max: bigint): void {
  if (value < 0n) throw new RangeError(`${name} must not be negative (got ${value})`);
  if (value > max) throw new RangeError(`${name} exceeds its on-chain type (got ${value}, max ${max})`);
}
