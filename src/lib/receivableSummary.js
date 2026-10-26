export const AGING_BUCKETS = [
  { value: 'current', label: 'Current' },
  { value: '1-30', label: '1–30 days' },
  { value: '31-60', label: '31–60 days' },
  { value: '61+', label: '61+ days' },
];

export const getAgingBucket = (daysOverdue) => {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  return '61+';
};

const sumCents = (rows) => rows.reduce((total, row) => total + Math.round(row.receivable.balance * 100), 0) / 100;

export const summarizeReceivables = (rows) => {
  const open = rows.filter((row) => row.receivable.balance > 0);
  const overdue = open.filter((row) => row.receivable.daysOverdue > 0);
  return {
    outstanding: sumCents(open),
    openCount: open.length,
    overdueTotal: sumCents(overdue),
    overdueCount: overdue.length,
    buckets: AGING_BUCKETS.map((bucket) => {
      const inBucket = open.filter((row) => getAgingBucket(row.receivable.daysOverdue) === bucket.value);
      return { ...bucket, count: inBucket.length, total: sumCents(inBucket) };
    }),
  };
};
