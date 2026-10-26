import { describe, expect, it } from 'vitest';
import { getAgingBucket, summarizeReceivables } from '../../src/lib/receivableSummary';

const row = (balance, daysOverdue) => ({ receivable: { balance, daysOverdue } });

describe('summarizeReceivables', () => {
  it('totals open balances and buckets them by days overdue', () => {
    const summary = summarizeReceivables([
      row(100.1, 0),
      row(50.2, 15),
      row(20, 45),
      row(10.05, 90),
      row(0, 200),
    ]);
    expect(summary.outstanding).toBe(180.35);
    expect(summary.openCount).toBe(4);
    expect(summary.overdueTotal).toBe(80.25);
    expect(summary.overdueCount).toBe(3);
    expect(summary.buckets.map((bucket) => [bucket.value, bucket.count, bucket.total])).toEqual([
      ['current', 1, 100.1],
      ['1-30', 1, 50.2],
      ['31-60', 1, 20],
      ['61+', 1, 10.05],
    ]);
  });

  it('returns zeros when nothing is open', () => {
    expect(summarizeReceivables([row(0, 0)]).outstanding).toBe(0);
  });
});

describe('getAgingBucket', () => {
  it.each([
    [-3, 'current'],
    [0, 'current'],
    [1, '1-30'],
    [30, '1-30'],
    [31, '31-60'],
    [60, '31-60'],
    [61, '61+'],
  ])('%i days overdue is %s', (days, bucket) => {
    expect(getAgingBucket(days)).toBe(bucket);
  });
});
