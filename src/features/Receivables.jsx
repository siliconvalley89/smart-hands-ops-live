import { useEffect, useState } from 'react';
import { collection, collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { AGING_BUCKETS, PAYMENT_METHODS, getAgingBucket, getReceivableStatus, recordPayment, voidPayment } from '../lib/payments';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const toDate = (value) => (value?.toDate ? value.toDate() : value ? new Date(value) : null);
const toTime = (value) => toDate(value)?.getTime() ?? 0;
const formatDay = (date) => (date ? date.toLocaleDateString() : 'Pending sign-off');
const todayInput = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const EMPTY_FORM = { amount: '', method: 'check', reference: '', receivedDate: '' };
const STATUS_STYLES = {
  Paid: 'text-teal-300',
  Overdue: 'text-rose-300',
  'Partially Paid': 'text-amber-300',
  Unpaid: 'text-slate-300',
};

const groupByJob = (snapshot) => snapshot.docs.reduce((groups, item) => {
  const jobId = item.ref.parent.parent.id;
  if (!groups[jobId]) groups[jobId] = [];
  groups[jobId].push({ ...item.data(), id: item.id });
  return groups;
}, {});

export default function Receivables({ recordedBy, setAppError }) {
  const [invoicedJobs, setInvoicedJobs] = useState([]);
  const [billingByJob, setBillingByJob] = useState({});
  const [consumablesByJob, setConsumablesByJob] = useState({});
  const [paymentsByJob, setPaymentsByJob] = useState({});
  const [showPaid, setShowPaid] = useState(false);
  const [openJobId, setOpenJobId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);

  useEffect(() => {
    const onError = (label) => (error) => {
      console.error(`Receivables ${label} listener failed`, error);
      setAppError('Unable to load receivables data.');
    };
    const unsubscribes = [
      onSnapshot(
        query(collection(db, 'jobs'), where('invoiceSent', '==', true)),
        (snapshot) => setInvoicedJobs(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
        onError('jobs'),
      ),
      onSnapshot(
        collection(db, 'jobBilling'),
        (snapshot) => setBillingByJob(Object.fromEntries(snapshot.docs.map((item) => [item.id, item.data()]))),
        onError('billing'),
      ),
      onSnapshot(collectionGroup(db, 'consumables'), (snapshot) => setConsumablesByJob(groupByJob(snapshot)), onError('consumables')),
      onSnapshot(collectionGroup(db, 'payments'), (snapshot) => setPaymentsByJob(groupByJob(snapshot)), onError('payments')),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [setAppError]);

  const nowMs = Date.now();
  const rows = invoicedJobs.map((job) => {
    const billing = billingByJob[job.id] || {};
    const consumables = (consumablesByJob[job.id] || []).map((item) => ({
      ...item,
      unitPrice: billing.consumablePrices?.[item.id] ?? 0,
    }));
    const merged = { ...job, ...billing, consumables };
    const payments = paymentsByJob[job.id] || [];
    return { job: merged, payments, receivable: getReceivableStatus(merged, payments, nowMs) };
  });

  const openRows = rows.filter((row) => row.receivable.balance > 0);
  const visibleRows = (showPaid ? rows : openRows)
    .sort((a, b) => b.receivable.daysOverdue - a.receivable.daysOverdue || b.receivable.balance - a.receivable.balance);
  const outstanding = openRows.reduce((sum, row) => sum + row.receivable.balance, 0);
  const overdueRows = openRows.filter((row) => row.receivable.daysOverdue > 0);
  const overdueTotal = overdueRows.reduce((sum, row) => sum + row.receivable.balance, 0);
  const buckets = AGING_BUCKETS.map((bucket) => {
    const inBucket = openRows.filter((row) => getAgingBucket(row.receivable.daysOverdue) === bucket.value);
    return { ...bucket, count: inBucket.length, total: inBucket.reduce((sum, row) => sum + row.receivable.balance, 0) };
  });

  const toggleRow = (row) => {
    if (openJobId === row.job.id) {
      setOpenJobId(null);
      return;
    }
    setOpenJobId(row.job.id);
    setForm({ ...EMPTY_FORM, amount: row.receivable.balance.toFixed(2), receivedDate: todayInput() });
    setFormError('');
    setVoidTarget(null);
  };

  const submitPayment = async (row) => {
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      setFormError('Enter an amount greater than zero.');
      return;
    }
    if (Math.round(amount * 100) > Math.round(row.receivable.balance * 100)) {
      setFormError(`Amount cannot exceed the balance of ${money(row.receivable.balance)}.`);
      return;
    }
    if (!form.receivedDate) {
      setFormError('Enter the date the payment was received.');
      return;
    }
    setSaving(true);
    try {
      await recordPayment(row.job.id, {
        amount,
        method: form.method,
        reference: form.reference.trim(),
        receivedAt: new Date(`${form.receivedDate}T12:00:00`),
        recordedBy,
      });
      setOpenJobId(null);
      setForm(EMPTY_FORM);
      setFormError('');
    } catch (error) {
      console.error('Record payment failed', error);
      setFormError('Unable to record payment.');
    } finally {
      setSaving(false);
    }
  };

  const submitVoid = async (jobId) => {
    const reason = voidTarget.reason.trim();
    if (!reason) {
      setFormError('Enter a reason to void a payment.');
      return;
    }
    setSaving(true);
    try {
      await voidPayment(jobId, voidTarget.paymentId, { reason, voidedBy: recordedBy });
      setVoidTarget(null);
      setFormError('');
    } catch (error) {
      console.error('Void payment failed', error);
      setFormError('Unable to void payment.');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const header = ['Job ID', 'Client', 'Task', 'Invoice total', 'Paid', 'Balance', 'Due date', 'Days overdue', 'Status'];
    const lines = visibleRows.map(({ job, receivable }) => [
      job.id,
      job.client,
      job.task,
      receivable.total.toFixed(2),
      receivable.paid.toFixed(2),
      receivable.balance.toFixed(2),
      receivable.dueDate ? receivable.dueDate.toISOString().slice(0, 10) : '',
      receivable.daysOverdue,
      receivable.status,
    ]);
    const csv = [header, ...lines].map((line) => line.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `receivables-${todayInput()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
          <div className="text-slate-400 text-sm">Outstanding</div>
          <div className="text-2xl font-semibold text-slate-100">{money(outstanding)}</div>
          <div className="text-slate-500 text-sm">{openRows.length} open invoice(s)</div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
          <div className="text-slate-400 text-sm">Overdue</div>
          <div className="text-2xl font-semibold text-rose-300">{money(overdueTotal)}</div>
          <div className="text-slate-500 text-sm">{overdueRows.length} overdue invoice(s)</div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4 grid grid-cols-2 gap-2">
          {buckets.map((bucket) => (
            <div key={bucket.value}>
              <div className="text-slate-400 text-xs">{bucket.label}</div>
              <div className="text-slate-100 font-semibold">{money(bucket.total)}</div>
              <div className="text-slate-500 text-xs">{bucket.count} invoice(s)</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-slate-300 text-sm">
          <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />
          Show paid invoices
        </label>
        <button type="button" onClick={exportCsv} disabled={visibleRows.length === 0} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition disabled:opacity-50">
          Export CSV
        </button>
      </div>

      {visibleRows.length === 0 ? (
        <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">No open invoices.</div>
      ) : (
        <div className="space-y-4">
          {visibleRows.map((row) => {
            const { job, payments, receivable } = row;
            const isOpen = openJobId === job.id;
            const history = [...payments].sort((a, b) => toTime(b.receivedAt) - toTime(a.receivedAt));
            return (
              <div key={job.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold text-slate-100">{job.client || 'Unnamed client'}</div>
                    <div className="text-slate-400 text-sm">{job.task || 'Service'} · {job.id}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-100">{money(receivable.balance)} due</div>
                    <div className="text-slate-400 text-sm">of {money(receivable.total)} · paid {money(receivable.paid)}</div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <span className={`font-semibold ${STATUS_STYLES[receivable.status] || 'text-slate-300'}`}>{receivable.status}</span>
                  <span className="text-slate-400">Due {formatDay(receivable.dueDate)}</span>
                  {receivable.daysOverdue > 0 && <span className="text-rose-300">{receivable.daysOverdue} days overdue</span>}
                  {job.clientEmail && <span className="text-slate-400">{job.clientEmail}</span>}
                </div>

                {receivable.balance > 0 && (
                  <div className="mt-3">
                    <button type="button" onClick={() => toggleRow(row)} className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition">
                      {isOpen ? 'Close' : 'Record payment'}
                    </button>
                  </div>
                )}

                <div className="mt-4 grid gap-4 border-t border-slate-700 pt-4">
                    {isOpen && receivable.balance > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input type="number" min="0" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
                        <select value={form.method} onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value }))} className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100">
                          {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                        </select>
                        <input type="date" value={form.receivedDate} onChange={(e) => setForm((prev) => ({ ...prev, receivedDate: e.target.value }))} className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
                        <input type="text" placeholder="Reference (check #, ACH trace, etc.)" value={form.reference} onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))} className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
                        <button type="button" disabled={saving} onClick={() => submitPayment(row)} className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50 sm:col-span-2">
                          {saving ? 'Saving…' : 'Save payment'}
                        </button>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-slate-400 text-sm">Payment history</div>
                      {history.length === 0 ? (
                        <div className="text-slate-500 text-sm">No payments recorded.</div>
                      ) : history.map((payment) => {
                        const methodLabel = PAYMENT_METHODS.find((method) => method.value === payment.method)?.label || payment.method;
                        const isVoiding = voidTarget?.paymentId === payment.id;
                        return (
                          <div key={payment.id} className={`rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm ${payment.voided ? 'opacity-60' : ''}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-slate-200">{formatDay(toDate(payment.receivedAt))} · {methodLabel}{payment.reference ? ` · ${payment.reference}` : ''}</span>
                              <span className={payment.voided ? 'text-slate-400 line-through' : 'text-slate-100 font-semibold'}>{money(payment.amount)}</span>
                            </div>
                            <div className="text-slate-500 text-xs mt-1">Recorded by {payment.recordedBy || 'unknown'}</div>
                            {payment.voided ? (
                              <div className="text-rose-300 text-xs mt-1">Voided by {payment.voidedBy || 'unknown'}: {payment.voidReason || 'no reason given'}</div>
                            ) : isVoiding ? (
                              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                <input type="text" placeholder="Reason for voiding" value={voidTarget.reason} onChange={(e) => setVoidTarget((prev) => ({ ...prev, reason: e.target.value }))} className="flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100" />
                                <button type="button" disabled={saving} onClick={() => submitVoid(job.id)} className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 transition disabled:opacity-50">Confirm void</button>
                                <button type="button" onClick={() => setVoidTarget(null)} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition">Cancel</button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setVoidTarget({ paymentId: payment.id, reason: '' }); setFormError(''); }} className="mt-2 rounded-xl border border-rose-500/60 px-3 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 transition">Void payment</button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {formError && <div className="text-rose-300 text-sm">{formError}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
