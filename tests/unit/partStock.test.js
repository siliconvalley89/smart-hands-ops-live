import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { partStockAdjustments, stockChangeAlerts } = require('../../functions/stock.js');

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

describe('stockChangeAlerts', () => {
  const used = { partId: 'p1', name: 'Cable', delta: -2, before: 10, after: 8, reorderPoint: 2 };

  it('alerts when a part is used on a job', () => {
    expect(stockChangeAlerts([used], 'job-1')).toEqual([
      { title: 'Part used', body: '2 x Cable used on job job-1. 8 on hand.', tag: 'part-used-p1' },
    ]);
  });

  it('does not alert when stock is returned', () => {
    expect(stockChangeAlerts([{ ...used, delta: 2, before: 8, after: 10 }], 'job-1')).toEqual([]);
  });

  it('alerts once when stock crosses the reorder point', () => {
    const crossing = { ...used, delta: -3, before: 4, after: 1, reorderPoint: 2 };
    const alerts = stockChangeAlerts([crossing], 'job-1');
    expect(alerts.map((alert) => alert.title)).toEqual(['Part used', 'Reorder part']);
    expect(alerts[1].body).toBe('Cable is down to 1 on hand (reorder at 2).');
  });

  it('does not repeat the reorder alert when already low', () => {
    const alerts = stockChangeAlerts([{ ...used, delta: -1, before: 2, after: 1, reorderPoint: 2 }], 'job-1');
    expect(alerts.map((alert) => alert.title)).toEqual(['Part used']);
  });
});
