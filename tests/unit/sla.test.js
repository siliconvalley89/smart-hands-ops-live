import { describe, expect, it } from 'vitest';
import { RESPONSE_TARGET_MS, formatSlaLabel, getResponseSla } from '../../src/lib/sla';

const created = Date.UTC(2026, 9, 26, 12);

describe('getResponseSla', () => {
  it('gives a pending immediate request four hours from creation', () => {
    const sla = getResponseSla({ status: 'Pending', createdAt: new Date(created) }, created + RESPONSE_TARGET_MS - 60_000);
    expect(sla).toEqual({ breached: false, remainingMs: 60_000 });
  });

  it('flags a request past its target', () => {
    const sla = getResponseSla({ status: 'Pending', createdAt: new Date(created) }, created + RESPONSE_TARGET_MS + 1_000);
    expect(sla.breached).toBe(true);
  });

  it('ignores scheduled requests, dispatched jobs, and jobs without a creation time', () => {
    expect(getResponseSla({ status: 'Pending', createdAt: new Date(created), scheduledFor: new Date(created + 1) }, created)).toBeNull();
    expect(getResponseSla({ status: 'En Route', createdAt: new Date(created) }, created)).toBeNull();
    expect(getResponseSla({ status: 'Pending' }, created)).toBeNull();
  });
});

describe('formatSlaLabel', () => {
  it('describes time left and time overdue', () => {
    expect(formatSlaLabel({ breached: false, remainingMs: (2 * 60 + 5) * 60_000 })).toBe('Respond within 2h 5m');
    expect(formatSlaLabel({ breached: false, remainingMs: 30 * 60_000 })).toBe('Respond within 30m');
    expect(formatSlaLabel({ breached: true, remainingMs: -90 * 60_000 })).toBe('Response overdue by 1h 30m');
  });
});
