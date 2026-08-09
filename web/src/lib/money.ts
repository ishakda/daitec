/**
 * Money math — all amounts are DZD with 2 decimals, computed in
 * integer centimes to avoid floating-point drift.
 * Pricing model (MVP): unit prices are HT (tax-exclusive); tax is
 * computed per line from tax_rate. A prices-include-tax company
 * setting is a planned Phase 2 option.
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export type LineInput = {
  quantity: number;
  unitPrice: number;
  discountPct?: number; // 0..100
  taxRate?: number;     // 0..100
};

export type LineComputed = {
  base: number;      // after line discount, before tax
  tax: number;
  lineTotal: number; // base + tax
};

export function computeLine(l: LineInput): LineComputed {
  const discount = Math.min(100, Math.max(0, l.discountPct ?? 0));
  const taxRate = Math.max(0, l.taxRate ?? 0);
  const base = round2(l.quantity * l.unitPrice * (1 - discount / 100));
  const tax = round2(base * (taxRate / 100));
  return { base, tax, lineTotal: round2(base + tax) };
}

export type TotalsInput = {
  lines: LineInput[];
  globalDiscount?: number; // absolute amount
  shipping?: number;
};

export type Totals = {
  subtotal: number;       // sum of line bases
  taxAmount: number;
  discountAmount: number; // global discount
  shippingAmount: number;
  total: number;
  lines: LineComputed[];
};

export function computeTotals(input: TotalsInput): Totals {
  const lines = input.lines.map(computeLine);
  const subtotal = round2(lines.reduce((s, l) => s + l.base, 0));
  const taxAmount = round2(lines.reduce((s, l) => s + l.tax, 0));
  const discountAmount = round2(Math.max(0, input.globalDiscount ?? 0));
  const shippingAmount = round2(Math.max(0, input.shipping ?? 0));
  const total = round2(subtotal + taxAmount + shippingAmount - discountAmount);
  if (total < 0) throw new Error("TOTAL_NEGATIVE: global discount exceeds document total");
  return { subtotal, taxAmount, discountAmount, shippingAmount, total, lines };
}

/** Weighted-average cost after an inbound receipt (mirrors the DB trigger). */
export function weightedAverage(
  currentQty: number,
  currentAvg: number,
  inQty: number,
  inCost: number
): number {
  if (inQty <= 0) return currentAvg;
  if (currentQty <= 0) return round4(inCost);
  return round4((currentQty * currentAvg + inQty * inCost) / (currentQty + inQty));
}
