import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCheckoutBlockReason } from '../../src/lib/jobDisplay';

const NOW = new Date('2026-10-24T18:00:00Z');
const HOUR = 60 * 60 * 1000;
const PHOTO_REQUIRED = 'Upload at least one after photo before checking out.';
const BREAK_REQUIRED = 'After 5 hours on site, take a 30-minute break before checking out.';

const job = (overrides = {}) => ({
  photoCounts: { after: 1 },
  checkInAt: new Date(NOW.getTime() - 2 * HOUR),
  breaks: [],
  ...overrides,
});

describe('getCheckoutBlockReason', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks checkout until an after photo exists', () => {
    expect(getCheckoutBlockReason(job({ photoCounts: { after: 0 } }))).toBe(PHOTO_REQUIRED);
    expect(getCheckoutBlockReason(job({ photoCounts: {} }))).toBe(PHOTO_REQUIRED);
  });

  it('allows checkout before five hours on site', () => {
    expect(getCheckoutBlockReason(job())).toBe('');
  });

  it('blocks checkout after five hours without a qualifying break', () => {
    const longShift = job({ checkInAt: new Date(NOW.getTime() - 5 * HOUR) });
    expect(getCheckoutBlockReason(longShift)).toBe(BREAK_REQUIRED);
  });

  it('blocks checkout when the only break is shorter than 30 minutes', () => {
    const shortBreak = job({
      checkInAt: new Date(NOW.getTime() - 6 * HOUR),
      breaks: [{ startAt: new Date(NOW.getTime() - 3 * HOUR), endAt: new Date(NOW.getTime() - 3 * HOUR + 29 * 60 * 1000) }],
    });
    expect(getCheckoutBlockReason(shortBreak)).toBe(BREAK_REQUIRED);
  });

  it('allows checkout after five hours with a 30-minute break', () => {
    const withBreak = job({
      checkInAt: new Date(NOW.getTime() - 6 * HOUR),
      breaks: [{ startAt: new Date(NOW.getTime() - 3 * HOUR), endAt: new Date(NOW.getTime() - 3 * HOUR + 30 * 60 * 1000) }],
    });
    expect(getCheckoutBlockReason(withBreak)).toBe('');
  });

  it('ignores breaks that are missing an end time', () => {
    const openBreak = job({
      checkInAt: new Date(NOW.getTime() - 6 * HOUR),
      breaks: [{ startAt: new Date(NOW.getTime() - 3 * HOUR) }],
    });
    expect(getCheckoutBlockReason(openBreak)).toBe(BREAK_REQUIRED);
  });

  it('reports the photo requirement first when both rules fail', () => {
    const both = job({ photoCounts: { after: 0 }, checkInAt: new Date(NOW.getTime() - 6 * HOUR) });
    expect(getCheckoutBlockReason(both)).toBe(PHOTO_REQUIRED);
  });
});
