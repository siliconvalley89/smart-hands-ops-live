import { describe, expect, it } from 'vitest';
import { calcInvoiceTotal } from '../../src/lib/invoiceTotals';

describe('calcInvoiceTotal', () => {
  it('is zero with no items and no service fee', () => {
    expect(calcInvoiceTotal()).toBe(0);
    expect(calcInvoiceTotal([], undefined)).toBe(0);
  });

  it('sums qty times unit price and adds the service fee', () => {
    const items = [
      { qty: 2, unitPrice: 12.5 },
      { qty: 1, unitPrice: 4 },
    ];
    expect(calcInvoiceTotal(items, 75)).toBe(104);
  });

  it('treats numeric strings and missing fields as numbers', () => {
    const items = [{ qty: '3', unitPrice: '10.25' }, { unitPrice: 5 }, { qty: 2 }];
    expect(calcInvoiceTotal(items, '20')).toBeCloseTo(30.75 + 20);
  });

  it('ignores a missing service fee', () => {
    expect(calcInvoiceTotal([{ qty: 1, unitPrice: 9 }], null)).toBe(9);
  });
});
