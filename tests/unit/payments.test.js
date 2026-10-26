import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/firebase', () => ({ db: {}, storage: {}, auth: {} }));

const { getInvoiceDueMillis, getReceivableStatus } = await import('../../src/lib/payments');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 25, 12).getTime();
const signedOffDaysAgo = (days) => new Date(NOW - days * DAY);
const job = (overrides = {}) => ({ serviceFee: 250, consumables: [], ...overrides });
const payment = (amount, voided = false) => ({ amount, voided });

describe('getReceivableStatus', () => {
  it('is Paid when payments cover the total', () => {
    const status = getReceivableStatus(job({ adminSignedOffAt: signedOffDaysAgo(5) }), [payment(250)], NOW);
    expect(status).toMatchObject({ total: 250, paid: 250, balance: 0, status: 'Paid', daysOverdue: 0 });
  });

  it('is Unpaid when nothing is paid and the invoice is not yet due', () => {
    const status = getReceivableStatus(job({ adminSignedOffAt: signedOffDaysAgo(5) }), [], NOW);
    expect(status).toMatchObject({ balance: 250, status: 'Unpaid', daysOverdue: 0 });
  });

  it('is Partially Paid when some is paid and the invoice is not yet due', () => {
    const status = getReceivableStatus(job({ adminSignedOffAt: signedOffDaysAgo(5) }), [payment(100)], NOW);
    expect(status).toMatchObject({ paid: 100, balance: 150, status: 'Partially Paid' });
  });

  it('is Overdue once the net-30 date has passed with a balance', () => {
    const status = getReceivableStatus(job({ adminSignedOffAt: signedOffDaysAgo(40) }), [payment(100)], NOW);
    expect(status.status).toBe('Overdue');
    expect(status.daysOverdue).toBe(10);
  });

  it('ignores voided payments', () => {
    const status = getReceivableStatus(job({ adminSignedOffAt: signedOffDaysAgo(5) }), [payment(250, true)], NOW);
    expect(status).toMatchObject({ paid: 0, balance: 250, status: 'Unpaid' });
  });

  it('never reports a negative balance when overpaid', () => {
    const status = getReceivableStatus(job({ adminSignedOffAt: signedOffDaysAgo(5) }), [payment(300)], NOW);
    expect(status).toMatchObject({ balance: 0, status: 'Paid' });
  });

  it('sums money in cents so decimal amounts do not drift', () => {
    const status = getReceivableStatus(job({ serviceFee: 0.3, adminSignedOffAt: signedOffDaysAgo(1) }), [payment(0.1), payment(0.2)], NOW);
    expect(status).toMatchObject({ balance: 0, status: 'Paid' });
  });

  it('is never overdue before the job is signed off', () => {
    const status = getReceivableStatus(job(), [], NOW);
    expect(status).toMatchObject({ status: 'Unpaid', daysOverdue: 0, dueDate: null });
  });
});

describe('getInvoiceDueMillis', () => {
  it('is 30 days after sign-off', () => {
    const signedOff = signedOffDaysAgo(3);
    expect(getInvoiceDueMillis({ adminSignedOffAt: signedOff })).toBe(signedOff.getTime() + 30 * DAY);
  });

  it('is null without a sign-off', () => {
    expect(getInvoiceDueMillis({})).toBeNull();
  });
});
