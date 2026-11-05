import { describe, expect, it } from 'vitest';
import {
  addPacificDays,
  formatPacificDate,
  pacificDayKey,
  pacificDayOf,
  pacificInputToMillis,
  pacificMinuteMs,
  pacificParts,
  pacificToMs,
  pacificWeekDays,
  toPacificInputValue,
} from '../../src/lib/pacificTime';

describe('pacificToMs', () => {
  it('converts Pacific wall-clock times to UTC instants across PDT and PST', () => {
    expect(new Date(pacificToMs({ year: 2026, month: 7, day: 15, hour: 8, minute: 0 })).toISOString()).toBe('2026-07-15T15:00:00.000Z');
    expect(new Date(pacificToMs({ year: 2026, month: 1, day: 15, hour: 8, minute: 0 })).toISOString()).toBe('2026-01-15T16:00:00.000Z');
    expect(new Date(pacificToMs({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 })).toISOString()).toBe('2026-03-08T10:30:00.000Z');
    expect(new Date(pacificToMs({ year: 2026, month: 11, day: 1, hour: 12, minute: 0 })).toISOString()).toBe('2026-11-01T20:00:00.000Z');
  });
});

describe('pacificParts and pacificDayOf', () => {
  it('reads the Pacific calendar day, not the UTC day', () => {
    const instant = new Date('2026-10-06T06:30:00Z');
    expect(pacificParts(instant)).toEqual({ year: 2026, month: 10, day: 5, hour: 23, minute: 30 });
    expect(pacificDayOf(instant)).toEqual({ year: 2026, month: 10, day: 5 });
  });
});

describe('pacificInputToMillis', () => {
  it('reads a datetime-local value as Pacific time', () => {
    expect(pacificInputToMillis('2026-07-15T08:00')).toBe(Date.parse('2026-07-15T15:00:00Z'));
  });

  it('round-trips through toPacificInputValue', () => {
    const ms = Date.parse('2026-07-15T15:00:00Z');
    expect(toPacificInputValue(ms)).toBe('2026-07-15T08:00');
    expect(pacificInputToMillis(toPacificInputValue(ms))).toBe(ms);
  });

  it('returns null for empty, malformed, impossible, or DST-skipped values', () => {
    expect(pacificInputToMillis('')).toBeNull();
    expect(pacificInputToMillis('not a date')).toBeNull();
    expect(pacificInputToMillis('2026-02-30T10:00')).toBeNull();
    expect(pacificInputToMillis('2026-03-08T02:30')).toBeNull();
  });
});

describe('pacificDayKey and addPacificDays', () => {
  it('formats and shifts Pacific calendar days across month and year ends', () => {
    expect(pacificDayKey({ year: 2026, month: 1, day: 5 })).toBe('2026-01-05');
    expect(addPacificDays({ year: 2026, month: 10, day: 31 }, 1)).toEqual({ year: 2026, month: 11, day: 1 });
    expect(addPacificDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
  });
});

describe('pacificWeekDays', () => {
  it('returns the Monday-to-Sunday week containing the anchor day', () => {
    const days = pacificWeekDays({ year: 2026, month: 10, day: 21 });
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ year: 2026, month: 10, day: 19 });
    expect(days[6]).toEqual({ year: 2026, month: 10, day: 25 });
  });
});

describe('pacificMinuteMs', () => {
  it('returns the instant for a minute of a Pacific day', () => {
    expect(pacificMinuteMs({ year: 2026, month: 7, day: 15 }, 8 * 60)).toBe(Date.parse('2026-07-15T15:00:00Z'));
  });
});

describe('formatPacificDate', () => {
  it('formats the Pacific date as MM/DD/YYYY', () => {
    expect(formatPacificDate(Date.parse('2026-10-06T06:30:00Z'))).toBe('10/05/2026');
  });
});
