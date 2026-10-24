import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { reminderStageFor } = require('../../functions/reminders.js');
const STAGES = [{ afterDays: 1 }, { afterDays: 7 }, { afterDays: 14 }];

describe('reminderStageFor', () => {
  it('returns no stage before the first reminder day', () => {
    expect(reminderStageFor(0, STAGES)).toBe(0);
  });

  it('returns the highest stage reached', () => {
    expect(reminderStageFor(1, STAGES)).toBe(1);
    expect(reminderStageFor(6, STAGES)).toBe(1);
    expect(reminderStageFor(7, STAGES)).toBe(2);
    expect(reminderStageFor(30, STAGES)).toBe(3);
  });

  it('still reports the stage on a later day when an earlier send failed', () => {
    expect(reminderStageFor(2, STAGES)).toBe(1);
  });
});
