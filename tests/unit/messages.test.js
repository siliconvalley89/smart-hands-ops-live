import { describe, expect, it } from 'vitest';
import { canUseJobThread, cleanMessageText, hasUnreadMessages } from '../../src/lib/messages';

describe('cleanMessageText', () => {
  it('trims text and rejects empty or oversized messages', () => {
    expect(cleanMessageText('  on site  ')).toBe('on site');
    expect(cleanMessageText('   ')).toBeNull();
    expect(cleanMessageText('x'.repeat(2000))).toHaveLength(2000);
    expect(cleanMessageText('x'.repeat(2001))).toBeNull();
    expect(cleanMessageText(undefined)).toBeNull();
  });
});

describe('hasUnreadMessages', () => {
  const at = new Date('2026-11-06T18:00:00Z');
  const earlier = new Date('2026-11-06T17:00:00Z');

  it('is false when the job has no messages yet', () => {
    expect(hasUnreadMessages({}, null)).toBe(false);
  });

  it('is true when there is a message and no read marker', () => {
    expect(hasUnreadMessages({ lastMessageAt: at }, undefined)).toBe(true);
  });

  it('compares the latest message with the last read time', () => {
    expect(hasUnreadMessages({ lastMessageAt: at }, earlier.getTime())).toBe(true);
    expect(hasUnreadMessages({ lastMessageAt: at }, at.getTime())).toBe(false);
    expect(hasUnreadMessages({ lastMessageAt: earlier }, at.getTime())).toBe(false);
  });
});

describe('canUseJobThread', () => {
  it('allows staff and field staff, not clients', () => {
    expect(canUseJobThread('admin')).toBe(true);
    expect(canUseJobThread('adminAssistant')).toBe(true);
    expect(canUseJobThread('tech')).toBe(true);
    expect(canUseJobThread('seniorConsultant')).toBe(true);
    expect(canUseJobThread('client')).toBe(false);
  });
});
