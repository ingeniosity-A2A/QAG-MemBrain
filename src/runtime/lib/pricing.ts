/**
 * Dynamic Pricing: Base rate + demand surge
 * Demand measured by backlog (jobs waiting / available techs)
 * Surge capped at 1.5x to maintain customer trust
 */

/**
 * Calculate dynamic price based on demand
 * @param basePrice - Base service price ($)
 * @param demand - Backlog ratio (jobs_waiting / available_techs); default 0
 * @returns Surge-adjusted price
 *
 * Formula: price = basePrice * (1 + min(0.5, demand/10))
 * At demand=0: price = basePrice * 1.0 (no surge)
 * At demand=5: price = basePrice * 1.05 (5% surge)
 * At demand=10+: price = basePrice * 1.5 (max 50% surge)
 */
export function estimatePrice(basePrice: number, demand: number = 0): number {
  const surge = 1 + Math.min(0.5, demand / 10);
  return Math.round(basePrice * surge);
}

/**
 * Get surge multiplier only (for display/logging)
 */
export function getSurgeMultiplier(demand: number = 0): number {
  return +(1 + Math.min(0.5, demand / 10)).toFixed(2);
}

/**
 * Inverse: given a final price and demand, estimate base price
 */
export function estimateBasePrice(finalPrice: number, demand: number = 0): number {
  const surge = 1 + Math.min(0.5, demand / 10);
  return Math.round(finalPrice / surge);
}

/**
 * Explain pricing breakdown for customer quote
 */
export function explainPricing(basePrice: number, demand: number = 0): {
  basePrice: number;
  surgeFactor: number;
  surgeAmount: number;
  finalPrice: number;
} {
  const surgeFactor = getSurgeMultiplier(demand);
  const finalPrice = estimatePrice(basePrice, demand);
  const surgeAmount = finalPrice - basePrice;

  return {
    basePrice,
    surgeFactor,
    surgeAmount,
    finalPrice,
  };
}

/**
 * Message for customer when surge is in effect
 */
export function getSurgeMessage(demand: number = 0, normal: string = 'normal'): string {
  if (demand < 3) {
    return 'Normal pricing.';
  }
  if (demand < 6) {
    return 'Slight demand surge (+5-10%).';
  }
  if (demand < 10) {
    return 'High demand. Price includes surge.';
  }
  return 'Very high demand. Premium pricing.';
}
