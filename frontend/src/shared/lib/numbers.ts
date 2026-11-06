/**
 * Strict decimal input parsing (SPEC-05).
 *
 * The client normalizes comma/point input into a dotted string for the server;
 * the server rejects NaN/Infinity/exponent/incomplete input, and empty is not
 * zero. Values stay strings — masses and money must never pass through a JS
 * number, and numeric identifiers are never converted to numbers.
 */

export interface DecimalOptions {
  /**
   * Maximum fraction digits the target column supports (NUMERIC(20,6) masses,
   * NUMERIC(20,2) money). Input above the supported precision is rejected.
   */
  maxFractionDigits?: number;
}

/** Parse user input into a finite non-negative decimal string, or null. */
export function parseDecimal(input: string, options: DecimalOptions = {}): string | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null; // empty is not zero (SPEC-05)
  }
  if (!/^[0-9]+([.,][0-9]+)?$/.test(trimmed)) {
    // Rejects letters, signs, exponent forms, NaN/Infinity words, Cyrillic and
    // other non-ASCII digits, multiple separators and incomplete input ("1.").
    return null;
  }
  const normalized = trimmed.replace(",", ".");
  const [integer, fraction = ""] = normalized.split(".");
  if (options.maxFractionDigits !== undefined && fraction.length > options.maxFractionDigits) {
    return null;
  }
  if (integer.length > 20) {
    // NUMERIC(20, ...) cannot hold a longer integer part.
    return null;
  }
  return normalized;
}
