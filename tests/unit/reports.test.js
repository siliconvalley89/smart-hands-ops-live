import { describe, expect, it } from 'vitest';
import { buildReport, reportCsvRows } from '../../src/lib/reports';

const at = (iso) => new Date(iso);

const jobs = [
  {
    id: 'a',
    createdAt: at('2026-10-01T08:00:00Z'),
    checkInAt: at('2026-10-01T10:00:00Z'),
    assignedTechName: 'Ana',
    location: '12 Main St ',
    status: 'Completed',
    adminSignedOffAt: at('2026-10-01T12:00:00Z'),
    consumables: [{ qty: 2, unitPrice: 50 }],
    serviceFee: 100,
  },
  {
    id: 'b',
    createdAt: at('2026-10-02T08:00:00Z'),
    checkInAt: at('2026-10-02T09:00:00Z'),
    assignedTechName: 'Ana',
    location: '12 main st',
    status: 'On Site',
  },
  {
    id: 'c',
    createdAt: at('2026-10-03T08:00:00Z'),
    assignedTechName: 'Ben',
    location: '99 Oak Ave',
    status: 'Assigned',
  },
];

const payments = {
  a: [
    { amount: 120 },
    { amount: 30, voided: true },
  ],
};

describe('buildReport', () => {
  const report = buildReport(jobs, payments);

  it('totals invoices for signed-off jobs and counts only non-voided payments', () => {
    expect(report.invoiced).toBe(200);
    expect(report.collected).toBe(120);
    expect(report.outstanding).toBe(80);
    expect(report.signedOffCount).toBe(1);
  });

  it('takes the median response time from created to check-in', () => {
    expect(report.medianResponseMinutes).toBe(90);
  });

  it('treats matching locations case-insensitively and trimmed as repeat visits', () => {
    expect(report.repeatJobs).toBe(2);
    expect(report.repeatRate).toBeCloseTo(2 / 3);
  });

  it('counts jobs and completions per tech, busiest first', () => {
    expect(report.byTech).toEqual([
      { name: 'Ana', jobs: 2, completed: 1 },
      { name: 'Ben', jobs: 1, completed: 0 },
    ]);
  });

  it('leaves response time empty when a job has no check-in', () => {
    expect(report.jobRows.find((row) => row.jobId === 'c').responseMinutes).toBeNull();
  });

  it('returns empty metrics for no jobs', () => {
    expect(buildReport([])).toMatchObject({ jobCount: 0, medianResponseMinutes: null, repeatRate: null, byTech: [] });
  });

  it('writes a header and one CSV line per job', () => {
    const rows = reportCsvRows(report);
    expect(rows).toHaveLength(4);
    expect(rows[1][1]).toBe('a');
    expect(rows[1][6]).toBe('200.00');
  });
});
