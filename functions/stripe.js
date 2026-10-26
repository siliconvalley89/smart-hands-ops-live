const APP_URL = 'https://smart-hands-live.web.app';

function checkoutProblem({ job, balanceCents }) {
  if (job.billingMigrated !== true) return 'Online payment is not available for this invoice. Please pay by check or transfer.';
  if (job.invoiceSent !== true) return 'The invoice has not been sent yet.';
  if (balanceCents <= 0) return 'Nothing is due on this job.';
  return null;
}

function checkoutSessionParams({ jobId, job, amountCents, appUrl = APP_URL }) {
  const description = job.task ? String(job.task).slice(0, 200) : undefined;
  return {
    mode: 'payment',
    // payment_method_types is omitted so the methods enabled in the Stripe Dashboard (card, US bank) are offered
    customer_email: job.clientEmail,
    client_reference_id: jobId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: { name: `Invoice balance ${jobId}`, ...(description ? { description } : {}) },
      },
    }],
    metadata: { jobId },
    payment_intent_data: { metadata: { jobId } },
    success_url: `${appUrl}/?payment=success`,
    cancel_url: `${appUrl}/?payment=cancelled`,
  };
}

// Decides what to do with the Checkout Session last created for a job.
// A complete session with no recorded payment is still settling (e.g. a US bank transfer), so no new charge is allowed.
function checkoutAction(session, { amountCents, paymentRecorded, paymentFailed }) {
  if (!session) return 'create';
  if (session.status === 'open') return session.amount_total === amountCents ? 'reuse' : 'expire';
  if (session.status === 'complete' && !paymentRecorded && !paymentFailed) return 'block';
  return 'create';
}

function paymentFromCheckoutSession(session, paymentMethodType = 'card') {
  return {
    amount: Math.round(Number(session.amount_total || 0)) / 100,
    method: paymentMethodType === 'us_bank_account' ? 'ach' : 'card',
    reference: session.payment_intent || session.id,
    receivedAt: new Date((session.created || Date.now() / 1000) * 1000),
  };
}

module.exports = { APP_URL, checkoutProblem, checkoutSessionParams, checkoutAction, paymentFromCheckoutSession };
