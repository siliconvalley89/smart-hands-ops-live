import { useState } from 'react';
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import useQuotes from '../hooks/useQuotes';
import { isQuoteExpired, quoteTotal } from '../lib/quotes';

const DEFAULT_VALID_DAYS = 30;
const MAX_LINES = 50;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inputClass = 'rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500';
const STATUS_CLASS = { Draft: 'text-slate-300', Sent: 'text-amber-300', Accepted: 'text-teal-300', Withdrawn: 'text-rose-300' };

const pad = (n) => String(n).padStart(2, '0');
const toDateInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const endOfDay = (dateInput) => new Date(`${dateInput}T23:59:59`);
const formatDate = (timestamp) => (timestamp?.toDate ? timestamp.toDate().toLocaleDateString() : '—');
const money = (amount) => `$${Number(amount || 0).toFixed(2)}`;

const emptyLine = () => ({ description: '', qty: '1', unitPrice: '' });

const emptyQuote = () => {
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + DEFAULT_VALID_DAYS);
  return {
    client: '', clientEmail: '', clientPhone: '', location: '', task: '', details: '',
    serviceFee: '', serviceFeeDescription: '', validUntil: toDateInput(validUntil), lines: [emptyLine()],
  };
};

const quoteToForm = (quote) => ({
  client: quote.client || '',
  clientEmail: quote.clientEmail || '',
  clientPhone: quote.clientPhone || '',
  location: quote.location || '',
  task: quote.task || '',
  details: quote.details || '',
  serviceFee: quote.serviceFee ? String(quote.serviceFee) : '',
  serviceFeeDescription: quote.serviceFeeDescription || '',
  validUntil: toDateInput(quote.validUntil.toDate()),
  lines: quote.lines.map((line) => ({ description: line.description, qty: String(line.qty), unitPrice: String(line.unitPrice) })),
});

const validateQuote = (form) => {
  if (!form.client.trim()) return 'Enter the client name.';
  if (!EMAIL_PATTERN.test(form.clientEmail.trim())) return 'Enter a valid client email.';
  if (!form.task.trim()) return 'Enter the service.';
  if (!form.validUntil || endOfDay(form.validUntil) <= new Date()) return 'Pick a valid-until date in the future.';
  const fee = Number(form.serviceFee || 0);
  if (!Number.isFinite(fee) || fee < 0) return 'Service fee must be zero or more.';
  if (form.lines.length === 0 || form.lines.length > MAX_LINES) return `Add between 1 and ${MAX_LINES} line items.`;
  for (const line of form.lines) {
    if (!line.description.trim()) return 'Each line needs a description.';
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1) return 'Quantities must be whole numbers of 1 or more.';
    const price = Number(line.unitPrice);
    if (line.unitPrice === '' || !Number.isFinite(price) || price < 0) return 'Unit prices must be zero or more.';
  }
  return '';
};

const toPayload = (form) => ({
  client: form.client.trim(),
  clientEmail: form.clientEmail.trim(),
  clientPhone: form.clientPhone.trim(),
  location: form.location.trim(),
  task: form.task.trim(),
  details: form.details.trim(),
  lines: form.lines.map((line) => ({
    description: line.description.trim(),
    qty: Number(line.qty),
    unitPrice: Number(line.unitPrice),
  })),
  serviceFee: Number(form.serviceFee || 0),
  serviceFeeDescription: form.serviceFeeDescription.trim(),
  validUntil: endOfDay(form.validUntil),
});

export default function QuotesPanel({ email, isAdmin }) {
  const quotes = useQuotes({ staff: true });
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const openForm = (quote = null) => {
    setForm(quote ? quoteToForm(quote) : emptyQuote());
    setEditingId(quote?.id || null);
    setMessage('');
  };
  const closeForm = () => {
    setForm(null);
    setEditingId(null);
  };
  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const updateLine = (index, field, value) => setForm((prev) => ({
    ...prev,
    lines: prev.lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)),
  }));
  const addLine = () => setForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }));
  const removeLine = (index) => setForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));

  const writeDraft = async () => {
    const payload = { ...toPayload(form), updatedBy: email, updatedAt: new Date() };
    if (editingId) {
      await updateDoc(doc(db, 'quotes', editingId), payload);
      return editingId;
    }
    const ref = await addDoc(collection(db, 'quotes'), {
      ...payload,
      status: 'Draft',
      createdBy: email,
      createdAt: new Date(),
    });
    return ref.id;
  };

  const save = async (send) => {
    const error = validateQuote(form);
    if (error) {
      setMessage(error);
      return;
    }
    setSaving(true);
    try {
      const id = await writeDraft();
      setEditingId(id);
      if (send) {
        await updateDoc(doc(db, 'quotes', id), { status: 'Sent', sentAt: new Date(), updatedBy: email, updatedAt: new Date() });
      }
      closeForm();
      setMessage(send ? 'Quote sent to the client.' : 'Draft saved.');
    } catch (err) {
      console.error('Save quote failed', err);
      setMessage('Unable to save quote.');
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (quote) => {
    if (!window.confirm('Withdraw this quote? The client will no longer be able to accept it.')) return;
    try {
      await updateDoc(doc(db, 'quotes', quote.id), { status: 'Withdrawn', updatedBy: email, updatedAt: new Date() });
      setMessage('Quote withdrawn.');
    } catch (err) {
      console.error('Withdraw quote failed', err);
      setMessage('Unable to withdraw quote.');
    }
  };

  const deleteDraft = async (quote) => {
    if (!window.confirm('Delete this draft quote?')) return;
    try {
      await deleteDoc(doc(db, 'quotes', quote.id));
      setMessage('Draft deleted.');
    } catch (err) {
      console.error('Delete quote failed', err);
      setMessage('Unable to delete draft.');
    }
  };

  const statusLabel = (quote) => (quote.status === 'Sent' && isQuoteExpired(quote) ? 'Expired' : quote.status);
  const openCount = quotes.filter((quote) => quote.status === 'Sent' && !isQuoteExpired(quote)).length;
  const formTotal = form
    ? quoteTotal(form.lines.map((line) => ({ qty: Number(line.qty) || 0, unitPrice: Number(line.unitPrice) || 0 })), Number(form.serviceFee) || 0)
    : 0;

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Quotes</h2>
          <p className="text-slate-400 text-sm mt-1">
            {quotes.length} {quotes.length === 1 ? 'quote' : 'quotes'}
            {openCount > 0 && <span className="text-amber-300"> · {openCount} awaiting client acceptance</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {expanded && !form && (
            <button type="button" onClick={() => openForm()} className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition">
              New quote
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setExpanded((prev) => !prev);
              closeForm();
            }}
            className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid gap-4 rounded-3xl bg-slate-900/70 border border-slate-700 p-5">
          {form && (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-xs text-slate-400">
                  Client name
                  <input type="text" value={form.client} onChange={(e) => updateField('client', e.target.value)} className={inputClass} />
                </label>
                <label className="grid gap-1 text-xs text-slate-400">
                  Client email (their sign-in email)
                  <input type="email" value={form.clientEmail} onChange={(e) => updateField('clientEmail', e.target.value)} className={inputClass} />
                </label>
                <label className="grid gap-1 text-xs text-slate-400">
                  Phone
                  <input type="tel" value={form.clientPhone} onChange={(e) => updateField('clientPhone', e.target.value)} className={inputClass} />
                </label>
                <label className="grid gap-1 text-xs text-slate-400">
                  Site location
                  <input type="text" value={form.location} onChange={(e) => updateField('location', e.target.value)} className={inputClass} />
                </label>
                <label className="grid gap-1 text-xs text-slate-400">
                  Service
                  <input type="text" value={form.task} onChange={(e) => updateField('task', e.target.value)} className={inputClass} />
                </label>
                <label className="grid gap-1 text-xs text-slate-400">
                  Valid until
                  <input type="date" value={form.validUntil} onChange={(e) => updateField('validUntil', e.target.value)} className={inputClass} />
                </label>
              </div>

              <label className="grid gap-1 text-xs text-slate-400">
                Scope of work
                <textarea rows={3} value={form.details} onChange={(e) => updateField('details', e.target.value)} className={inputClass} />
              </label>

              <div className="grid gap-2">
                <p className="text-xs uppercase text-slate-400">Line items</p>
                {form.lines.map((line, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_5rem_7rem_auto] sm:items-center">
                    <input type="text" placeholder="Description" value={line.description} onChange={(e) => updateLine(index, 'description', e.target.value)} className={inputClass} />
                    <input type="number" min="1" step="1" aria-label="Quantity" value={line.qty} onChange={(e) => updateLine(index, 'qty', e.target.value)} className={inputClass} />
                    <input type="number" min="0" step="0.01" placeholder="Unit price" aria-label="Unit price" value={line.unitPrice} onChange={(e) => updateLine(index, 'unitPrice', e.target.value)} className={inputClass} />
                    <button type="button" onClick={() => removeLine(index)} disabled={form.lines.length === 1} className="rounded-xl border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 transition disabled:opacity-40">Remove</button>
                  </div>
                ))}
                <button type="button" onClick={addLine} disabled={form.lines.length >= MAX_LINES} className="justify-self-start rounded-xl border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 transition disabled:opacity-40">
                  Add line
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-slate-400">
                  Service fee
                  <input type="number" min="0" step="0.01" value={form.serviceFee} onChange={(e) => updateField('serviceFee', e.target.value)} className={inputClass} />
                </label>
                <label className="grid gap-1 text-xs text-slate-400">
                  Service fee description
                  <input type="text" value={form.serviceFeeDescription} onChange={(e) => updateField('serviceFeeDescription', e.target.value)} className={inputClass} />
                </label>
              </div>

              <p className="text-sm text-slate-200">Total: <span className="font-semibold text-white">{money(formTotal)}</span></p>

              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={saving} onClick={() => save(true)} className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition disabled:opacity-50">
                  Send to client
                </button>
                <button type="button" disabled={saving} onClick={() => save(false)} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition disabled:opacity-50">
                  Save draft
                </button>
                <button type="button" onClick={closeForm} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {message && <p className="text-sm text-slate-300">{message}</p>}

          {quotes.length === 0 ? (
            <p className="text-slate-400 text-sm">No quotes yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-700">
              <table className="w-full text-sm text-left text-slate-300">
                <thead className="bg-slate-800 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Client</th>
                    <th className="px-3 py-2">Service</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Valid until</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id} className="border-t border-slate-700">
                      <td className="px-3 py-2">{quote.client}</td>
                      <td className="px-3 py-2">{quote.task || '—'}</td>
                      <td className="px-3 py-2 text-right">{money(quoteTotal(quote.lines, quote.serviceFee))}</td>
                      <td className="px-3 py-2">{formatDate(quote.validUntil)}</td>
                      <td className={`px-3 py-2 font-semibold ${STATUS_CLASS[quote.status] || ''}`}>{statusLabel(quote)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-2">
                          {quote.status === 'Draft' && (
                            <button type="button" onClick={() => openForm(quote)} className="rounded-xl border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 transition">Edit</button>
                          )}
                          {quote.status === 'Sent' && (
                            <button type="button" onClick={() => withdraw(quote)} className="rounded-xl border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 transition">Withdraw</button>
                          )}
                          {quote.status === 'Draft' && isAdmin && (
                            <button type="button" onClick={() => deleteDraft(quote)} className="rounded-xl border border-rose-700 px-3 py-1 text-xs text-rose-300 hover:bg-rose-950 transition">Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
