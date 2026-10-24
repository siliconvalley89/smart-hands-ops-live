import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { NET_TERMS_DAYS } from './invoice';
import { calcInvoiceTotal } from './invoiceTotals';
import { toMillis } from './jobTime';

export const PAYMENT_METHODS = [
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH / wire' },
  { value: 'card', label: 'Card (taken manually)' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

export const AGING_BUCKETS = [
  { value: 'current', label: 'Current' },
  { value: '1-30', label: '1–30 days' },
  { value: '31-60', label: '31–60 days' },
  { value: '61+', label: '61+ days' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const toCents = (amount) => Math.round(Number(amount || 0) * 100);

export const getInvoiceDueMillis = (job) => {
  const signedOff = toMillis(job.adminSignedOffAt);
  return signedOff ? signedOff + NET_TERMS_DAYS * DAY_MS : null;
};

export const getReceivableStatus = (job, payments = [], nowMs = Date.now()) => {
  const totalCents = toCents(calcInvoiceTotal(job.consumables || [], job.serviceFee));
  const paidCents = payments
    .filter((payment) => !payment.voided)
    .reduce((sum, payment) => sum + toCents(payment.amount), 0);
  const balanceCents = Math.max(0, totalCents - paidCents);
  const dueMs = getInvoiceDueMillis(job);
  const daysOverdue = dueMs && balanceCents > 0 && nowMs > dueMs ? Math.floor((nowMs - dueMs) / DAY_MS) : 0;

  let status = 'Unpaid';
  if (balanceCents === 0) status = 'Paid';
  else if (daysOverdue > 0) status = 'Overdue';
  else if (paidCents > 0) status = 'Partially Paid';

  return {
    total: totalCents / 100,
    paid: paidCents / 100,
    balance: balanceCents / 100,
    dueDate: dueMs ? new Date(dueMs) : null,
    daysOverdue,
    status,
  };
};

export const getAgingBucket = (daysOverdue) => {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  return '61+';
};

export const recordPayment = (jobId, { amount, method, reference, receivedAt, recordedBy }) =>
  addDoc(collection(db, 'jobs', jobId, 'payments'), {
    amount: Number(amount),
    method,
    reference: reference || '',
    receivedAt,
    recordedAt: new Date(),
    recordedBy,
    voided: false,
  });

export const voidPayment = (jobId, paymentId, { reason, voidedBy }) =>
  updateDoc(doc(db, 'jobs', jobId, 'payments', paymentId), {
    voided: true,
    voidReason: reason,
    voidedBy,
    voidedAt: new Date(),
  });
