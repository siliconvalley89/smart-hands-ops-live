import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { APP_URL, checkoutProblem, checkoutSessionParams, paymentFromCheckoutSession } = require('../../functions/stripe.js');

const payable = { billingMigrated: true, invoiceSent: true, clientEmail: 'client@test.dev', task: 'Rack install' };

describe('checkoutProblem', () => {
  it('allows a sent, migrated invoice with a balance', () => {
    expect(checkoutProblem({ job: payable, balanceCents: 1250 })).toBeNull();
  });

  it('refuses legacy jobs that were not migrated to separate billing', () => {
    expect(checkoutProblem({ job: { ...payable, billingMigrated: false }, balanceCents: 1250 })).toMatch(/not available/);
  });

  it('refuses invoices that have not been sent', () => {
    expect(checkoutProblem({ job: { ...payable, invoiceSent: false }, balanceCents: 1250 })).toBe('The invoice has not been sent yet.');
  });

  it('refuses when nothing is due', () => {
    expect(checkoutProblem({ job: payable, balanceCents: 0 })).toBe('Nothing is due on this job.');
    expect(checkoutProblem({ job: payable, balanceCents: -100 })).toBe('Nothing is due on this job.');
  });
});

describe('checkoutSessionParams', () => {
  const params = checkoutSessionParams({ jobId: 'job1', job: payable, amountCents: 12345 });

  it('creates a one-time card payment for the exact cents owed', () => {
    expect(params.mode).toBe('payment');
    expect(params.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 12345 });
    expect(params.line_items[0].quantity).toBe(1);
  });

  it('ties the session to the job and the client email', () => {
    expect(params.client_reference_id).toBe('job1');
    expect(params.metadata).toEqual({ jobId: 'job1' });
    expect(params.payment_intent_data.metadata).toEqual({ jobId: 'job1' });
    expect(params.customer_email).toBe('client@test.dev');
  });

  it('returns the client to the app with a payment flag', () => {
    expect(params.success_url).toBe(`${APP_URL}/?payment=success`);
    expect(params.cancel_url).toBe(`${APP_URL}/?payment=cancelled`);
  });

  it('truncates a long task description to 200 characters', () => {
    const long = checkoutSessionParams({ jobId: 'j', job: { ...payable, task: 'x'.repeat(300) }, amountCents: 100 });
    expect(long.line_items[0].price_data.product_data.description).toHaveLength(200);
  });
});

describe('paymentFromCheckoutSession', () => {
  it('records the paid amount in dollars against the payment intent', () => {
    const payment = paymentFromCheckoutSession({
      id: 'cs_1',
      amount_total: 12345,
      payment_intent: 'pi_1',
      created: 1790000000,
    });
    expect(payment).toMatchObject({ amount: 123.45, method: 'card', reference: 'pi_1' });
    expect(payment.receivedAt).toEqual(new Date(1790000000 * 1000));
  });

  it('falls back to the session id when there is no payment intent', () => {
    expect(paymentFromCheckoutSession({ id: 'cs_2', amount_total: 500, created: 1 }).reference).toBe('cs_2');
  });
});
