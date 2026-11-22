/**
 * VAT handling for Instant Gaming prices.
 *
 * Instant Gaming's product pages and search index expose net prices; German
 * buyers see the country's VAT added at checkout. The plugin shows the gross
 * price, so the net amount from the backend is multiplied by the standard VAT
 * rate of the configured country.
 *
 * Rates are best-effort standard rates for consumer sales. Countries without a
 * known rate keep the net price and get no tax label instead of a wrong number.
 */

const VAT_RATES: Readonly<Record<string, number>> = {
  // EU
  AT: 20,
  BE: 21,
  BG: 20,
  CY: 19,
  CZ: 21,
  DE: 19,
  DK: 25,
  EE: 22,
  ES: 21,
  FI: 25.5,
  FR: 20,
  GR: 24,
  HR: 25,
  HU: 27,
  IE: 23,
  IT: 22,
  LT: 21,
  LU: 17,
  LV: 21,
  MT: 18,
  NL: 21,
  PL: 23,
  PT: 23,
  RO: 21,
  SE: 25,
  SI: 22,
  SK: 23,
  // Neighbouring markets
  GB: 20,
  CH: 8.1,
  NO: 25,
  IS: 24,
  RS: 20,
  TR: 20,
  UA: 20,
};

/** Standard VAT rate in percent, or null when the country is unknown. */
export function vatRate(country: string | null | undefined): number | null {
  if (typeof country !== 'string') return null;
  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return Object.hasOwn(VAT_RATES, code) ? (VAT_RATES[code] ?? null) : null;
}

export interface GrossPrice {
  /** Net price plus VAT, rounded to cents. Equal to `net` when no rate is known. */
  amount: number;
  /** VAT rate in percent, or null when no rate applies/was found. */
  vatPercent: number | null;
}

/** Convert a net price into the gross price shown to the buyer. */
export function grossPrice(net: number, country?: string | null): GrossPrice {
  if (!Number.isFinite(net)) return { amount: net, vatPercent: null };

  const rate = vatRate(country);
  if (rate === null) return { amount: net, vatPercent: null };

  const amount = Math.round(net * (1 + rate / 100) * 100) / 100;
  return { amount, vatPercent: rate };
}
