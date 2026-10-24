import { calcInvoiceTotal } from './invoiceTotals';

export const quoteTotal = (lines = [], serviceFee = 0) => calcInvoiceTotal(lines, serviceFee);

const toMillis = (value) => (typeof value?.toMillis === 'function' ? value.toMillis() : new Date(value).getTime());

export const isQuoteExpired = (quote, now = Date.now()) => !(toMillis(quote.validUntil) > now);

export const canAcceptQuote = (quote, now = Date.now()) => quote.status === 'Sent' && !isQuoteExpired(quote, now);
