const MAX_QUOTE_LINES = 50;

const toCents = (amount) => Math.round(Number(amount) * 100);

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : new Date(value).getTime();
}

function quoteTotalCents(lines, serviceFee) {
  return lines.reduce((sum, line) => sum + toCents(line.qty * line.unitPrice), 0) + toCents(serviceFee || 0);
}

function quoteLinesProblem(lines) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_QUOTE_LINES) {
    return `Add between 1 and ${MAX_QUOTE_LINES} line items.`;
  }
  for (const line of lines) {
    if (typeof line?.description !== 'string' || !line.description.trim()) return 'Each line needs a description.';
    if (!Number.isInteger(line.qty) || line.qty < 1) return 'Quantities must be whole numbers of 1 or more.';
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) return 'Unit prices must be zero or more.';
  }
  return null;
}

function quoteAcceptProblem(quote, nowMs) {
  if (quote.status !== 'Sent') return 'This quote is no longer open to accept.';
  if (!(toMillis(quote.validUntil) > nowMs)) return 'This quote has expired.';
  return quoteLinesProblem(quote.lines);
}

function buildQuoteJob(quote, { quoteId, acceptedBy, now }) {
  return {
    job: {
      client: quote.client || '',
      clientEmail: quote.clientEmail,
      clientPhone: quote.clientPhone || '',
      location: quote.location || '',
      rawLocation: quote.location || '',
      lat: null,
      lng: null,
      task: quote.task || '',
      details: quote.details || '',
      serialNumber: '',
      scheduledFor: null,
      scheduledEnd: null,
      status: 'Pending',
      assignedTechName: '',
      assignedTechEmail: '',
      assignedTechDistanceMiles: null,
      assignedTechDistanceKm: null,
      billingMigrated: true,
      invoiceSent: false,
      clientSignedOff: false,
      source: 'quote',
      quoteId,
      createdByRole: 'client',
      createdAt: now,
      updatedBy: acceptedBy,
    },
    billing: {
      serviceFee: Number(quote.serviceFee || 0),
      serviceFeeDescription: quote.serviceFeeDescription || '',
      quoteId,
      updatedAt: now,
    },
    consumables: quote.lines.map((line) => ({
      description: line.description.trim(),
      qty: line.qty,
      unitPrice: line.unitPrice,
    })),
  };
}

module.exports = { quoteTotalCents, quoteLinesProblem, quoteAcceptProblem, buildQuoteJob };
