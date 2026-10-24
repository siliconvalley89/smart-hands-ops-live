import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { partStockAdjustments } = require('../../functions/stock.js');

describe('partStockAdjustments', () => {
  it('takes stock when a part-linked consumable is added', () => {
    expect(partStockAdjustments(undefined, { partId: 'p1', qty: 2 })).toEqual({ p1: -2 });
  });

  it('returns stock when a part-linked consumable is deleted', () => {
    expect(partStockAdjustments({ partId: 'p1', qty: 2 }, undefined)).toEqual({ p1: 2 });
  });

  it('applies only the quantity change on an edit', () => {
    expect(partStockAdjustments({ partId: 'p1', qty: 2 }, { partId: 'p1', qty: 5 })).toEqual({ p1: -3 });
  });

  it('moves stock between parts when the part changes', () => {
    expect(partStockAdjustments({ partId: 'p1', qty: 2 }, { partId: 'p2', qty: 2 })).toEqual({ p1: 2, p2: -2 });
  });

  it('ignores consumables without a part', () => {
    expect(partStockAdjustments(undefined, { description: 'Tape', qty: 3 })).toEqual({});
    expect(partStockAdjustments({ description: 'Tape', qty: 3 }, undefined)).toEqual({});
  });

  it('produces no adjustment when the quantity is unchanged', () => {
    expect(partStockAdjustments({ partId: 'p1', qty: 2 }, { partId: 'p1', qty: 2, description: 'Cable 2' })).toEqual({});
  });
});
