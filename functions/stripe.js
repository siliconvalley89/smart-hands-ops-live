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

function paymentFromCheckoutSession(session) {
  return {
    amount: Math.round(Number(session.amount_total || 0)) / 100,
    method: 'card',
    reference: session.payment_intent || session.id,
    receivedAt: new Date((session.created || Date.now() / 1000) * 1000),
  };
}

module.exports = { APP_URL, checkoutProblem, checkoutSessionParams, paymentFromCheckoutSession };
