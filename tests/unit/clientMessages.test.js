import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { canUseClientThread, hasUnreadClientMessages } from '../../src/lib/messages';

const require = createRequire(import.meta.url);
const { clientMessageRecipient } = require('../../functions/messages.js');

const job = { task: 'Rack and stack', client: 'Acme', clientEmail: 'client@example.com', assignedTechEmail: 'tech@example.com' };

describe('clientMessageRecipient', () => {
  it('sends a customer message to office staff', () => {
    expect(clientMessageRecipient({ authorRole: 'client' }, job)).toEqual({ roles: ['admin', 'adminAssistant'] });
  });

  it('sends a staff reply to the customer, not the technician', () => {
    expect(clientMessageRecipient({ authorRole: 'adminAssistant' }, job)).toEqual({ email: 'client@example.com' });
    expect(clientMessageRecipient({ authorRole: 'admin' }, job)).toEqual({ email: 'client@example.com' });
  });

  it('sends nothing when the job has no customer email', () => {
    expect(clientMessageRecipient({ authorRole: 'admin' }, { client: 'Acme' })).toBeNull();
  });
});

describe('client thread access and unread state', () => {
  it('lets customers and office staff use the client thread, not technicians', () => {
    expect(canUseClientThread('client')).toBe(true);
    expect(canUseClientThread('admin')).toBe(true);
    expect(canUseClientThread('adminAssistant')).toBe(true);
    expect(canUseClientThread('tech')).toBe(false);
    expect(canUseClientThread('seniorConsultant')).toBe(false);
  });

  it('shows unread only for messages someone else wrote after the last read', () => {
    const at = new Date('2026-11-06T18:00:00Z');
    const read = new Date('2026-11-06T17:00:00Z').getTime();
    expect(hasUnreadClientMessages({ lastClientMessageAt: at, lastClientMessageBy: 'staff@example.com' }, read, 'client@example.com')).toBe(true);
    expect(hasUnreadClientMessages({ lastClientMessageAt: at, lastClientMessageBy: 'client@example.com' }, read, 'client@example.com')).toBe(false);
    expect(hasUnreadClientMessages({ lastClientMessageAt: at, lastClientMessageBy: 'staff@example.com' }, at.getTime(), 'client@example.com')).toBe(false);
    expect(hasUnreadClientMessages({}, null, 'client@example.com')).toBe(false);
  });
});
