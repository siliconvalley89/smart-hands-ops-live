import { describe, expect, it } from 'vitest';
import { approvedScheduleFields, jobWindowMs, localInputToMillis, toDateTimeLocal } from '../../src/lib/reschedule';

const HOUR = 60 * 60 * 1000;

describe('jobWindowMs', () => {
  it('keeps the window length the job already has', () => {
    const job = { scheduledFor: new Date(2026, 9, 26, 9), scheduledEnd: new Date(2026, 9, 26, 12) };
    expect(jobWindowMs(job)).toBe(3 * HOUR);
  });

  it('falls back to two hours when the job has no usable window', () => {
    expect(jobWindowMs({})).toBe(2 * HOUR);
    expect(jobWindowMs({ scheduledFor: new Date(2026, 9, 26, 12), scheduledEnd: new Date(2026, 9, 26, 9) })).toBe(2 * HOUR);
  });
});

describe('approvedScheduleFields', () => {
  it('moves the start and keeps the same length', () => {
    const job = { scheduledFor: new Date(2026, 9, 26, 9), scheduledEnd: new Date(2026, 9, 26, 10, 30) };
    const start = new Date(2026, 9, 28, 14).getTime();
    const fields = approvedScheduleFields(job, start);
    expect(fields.scheduledFor.getTime()).toBe(start);
    expect(fields.scheduledEnd.getTime() - fields.scheduledFor.getTime()).toBe(90 * 60 * 1000);
  });
});

describe('datetime-local helpers', () => {
  it('round-trips a local minute through the input format', () => {
    const ms = new Date(2026, 9, 26, 9, 30).getTime();
    expect(toDateTimeLocal(ms)).toBe('2026-10-26T09:30');
    expect(localInputToMillis(toDateTimeLocal(ms))).toBe(ms);
  });

  it('returns null for an empty or invalid value', () => {
    expect(localInputToMillis('')).toBeNull();
    expect(localInputToMillis('not a date')).toBeNull();
  });
});
