import { describe, it, expect } from "vitest";
import { computeLine, computeTotals, weightedAverage, round2 } from "../money";

describe("computeLine", () => {
  it("computes base, tax and total", () => {
    const l = computeLine({ quantity: 2, unitPrice: 32000, taxRate: 19 });
    expect(l.base).toBe(64000);
    expect(l.tax).toBe(12160);
    expect(l.lineTotal).toBe(76160);
  });
  it("applies line discount before tax", () => {
    const l = computeLine({ quantity: 10, unitPrice: 100, discountPct: 25, taxRate: 19 });
    expect(l.base).toBe(750);
    expect(l.tax).toBe(142.5);
    expect(l.lineTotal).toBe(892.5);
  });
  it("clamps discount to 0..100", () => {
    expect(computeLine({ quantity: 1, unitPrice: 100, discountPct: 150 }).base).toBe(0);
    expect(computeLine({ quantity: 1, unitPrice: 100, discountPct: -10 }).base).toBe(100);
  });
  it("handles decimal quantities without float drift", () => {
    const l = computeLine({ quantity: 0.3, unitPrice: 0.1, taxRate: 0 });
    expect(l.base).toBe(0.03);
  });
});

describe("computeTotals", () => {
  it("sums lines, applies global discount and shipping", () => {
    const t = computeTotals({
      lines: [
        { quantity: 2, unitPrice: 32000, taxRate: 19 },
        { quantity: 5, unitPrice: 31000, taxRate: 19 },
      ],
      globalDiscount: 1000,
      shipping: 500,
    });
    expect(t.subtotal).toBe(219000);
    expect(t.taxAmount).toBe(41610);
    expect(t.total).toBe(219000 + 41610 + 500 - 1000);
  });
  it("rejects a discount exceeding the document total", () => {
    expect(() => computeTotals({ lines: [{ quantity: 1, unitPrice: 100 }], globalDiscount: 500 }))
      .toThrow(/TOTAL_NEGATIVE/);
  });
  it("matches the verified e2e invoice figures", () => {
    const t = computeTotals({ lines: [{ quantity: 5, unitPrice: 31000, taxRate: 19 }] });
    expect(t.total).toBe(184450);
  });
});

describe("weightedAverage", () => {
  it("mirrors the DB trigger math", () => {
    expect(weightedAverage(10, 100, 10, 200)).toBe(150);
  });
  it("uses incoming cost when stock is empty or negative", () => {
    expect(weightedAverage(0, 0, 5, 80)).toBe(80);
    expect(weightedAverage(-3, 50, 5, 80)).toBe(80);
  });
  it("keeps current average on outbound", () => {
    expect(weightedAverage(10, 150, 0, 0)).toBe(150);
    expect(weightedAverage(10, 150, -5, 999)).toBe(150);
  });
  it("rounds to 4 decimals", () => {
    expect(weightedAverage(3, 10, 1, 11)).toBe(10.25);
    expect(weightedAverage(3, 0.3333, 3, 0.6667)).toBe(0.5);
  });
});

describe("debt & payment allocation rules (pure math)", () => {
  it("partial payment leaves the correct receivable", () => {
    const total = computeTotals({ lines: [{ quantity: 5, unitPrice: 31000, taxRate: 19 }] }).total;
    const paid = 100000;
    expect(round2(total - paid)).toBe(84450);
    expect(round2(total - paid - 50000)).toBe(34450);
  });
  it("change is computed from cash received", () => {
    const total = computeTotals({ lines: [{ quantity: 2, unitPrice: 32000, taxRate: 19 }] }).total;
    expect(round2(80000 - total)).toBe(3840);
  });
});
