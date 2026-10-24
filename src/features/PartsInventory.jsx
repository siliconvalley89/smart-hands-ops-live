import { useState } from 'react';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const EMPTY_PART = { name: '', sku: '', onHand: '', reorderPoint: '' };
const inputClass = 'rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500';

const isCount = (value) => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

const validatePart = (values) => {
  if (!values.name.trim()) return 'Enter a part name.';
  if (!isCount(values.onHand) || !isCount(values.reorderPoint)) return 'On hand and reorder point must be zero or more.';
  return '';
};

export default function PartsInventory({ parts }) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState(EMPTY_PART);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_PART);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const lowStockCount = parts.filter((part) => Number(part.onHand) <= Number(part.reorderPoint)).length;

  const addPart = async (e) => {
    e.preventDefault();
    const error = validatePart(form);
    if (error) {
      setMessage(error);
      return;
    }
    setSaving(true);
    try {
      const now = new Date();
      await addDoc(collection(db, 'parts'), {
        name: form.name.trim(),
        sku: form.sku.trim(),
        onHand: Number(form.onHand),
        reorderPoint: Number(form.reorderPoint),
        createdAt: now,
        updatedAt: now,
      });
      setForm(EMPTY_PART);
      setMessage('Part added.');
    } catch (err) {
      console.error('Add part failed', err);
      setMessage('Unable to add part.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (part) => {
    setEditingId(part.id);
    setDraft({
      name: part.name || '',
      sku: part.sku || '',
      onHand: String(part.onHand ?? ''),
      reorderPoint: String(part.reorderPoint ?? ''),
    });
    setMessage('');
  };

  const saveEdit = async (part) => {
    const error = validatePart(draft);
    if (error) {
      setMessage(error);
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'parts', part.id), {
        name: draft.name.trim(),
        sku: draft.sku.trim(),
        onHand: Number(draft.onHand),
        reorderPoint: Number(draft.reorderPoint),
        updatedAt: new Date(),
      });
      setEditingId(null);
      setMessage('Part saved.');
    } catch (err) {
      console.error('Save part failed', err);
      setMessage('Unable to save part.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Parts inventory</h2>
          <p className="text-slate-400 text-sm mt-1">
            {parts.length} {parts.length === 1 ? 'part' : 'parts'}
            {lowStockCount > 0 && <span className="text-amber-300"> · {lowStockCount} at or below reorder point</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {expanded && (
        <div className="grid gap-4 rounded-3xl bg-slate-900/70 border border-slate-700 p-5">
          <form onSubmit={addPart} className="grid gap-3 sm:grid-cols-5 sm:items-end">
            <label className="grid gap-1 text-xs text-slate-400 sm:col-span-2">
              Name
              <input type="text" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} className={inputClass} />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              SKU
              <input type="text" value={form.sku} onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))} className={inputClass} />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              On hand
              <input type="number" min="0" step="1" value={form.onHand} onChange={(e) => setForm((prev) => ({ ...prev, onHand: e.target.value }))} className={inputClass} />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Reorder at
              <input type="number" min="0" step="1" value={form.reorderPoint} onChange={(e) => setForm((prev) => ({ ...prev, reorderPoint: e.target.value }))} className={inputClass} />
            </label>
            <button type="submit" disabled={saving} className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition disabled:opacity-50 sm:col-span-5 sm:justify-self-start">
              Add part
            </button>
          </form>

          {message && <p className="text-sm text-slate-300">{message}</p>}

          {parts.length === 0 ? (
            <p className="text-slate-400 text-sm">No parts yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-700">
              <table className="w-full text-sm text-left text-slate-300">
                <thead className="bg-slate-800 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Part</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2 text-right">On hand</th>
                    <th className="px-3 py-2 text-right">Reorder at</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {parts.map((part) => {
                    const isEditing = editingId === part.id;
                    const isLow = Number(part.onHand) <= Number(part.reorderPoint);
                    return (
                      <tr key={part.id} className="border-t border-slate-700">
                        <td className="px-3 py-2">
                          {isEditing ? <input type="text" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} className={`${inputClass} w-full`} /> : part.name}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? <input type="text" value={draft.sku} onChange={(e) => setDraft((prev) => ({ ...prev, sku: e.target.value }))} className={`${inputClass} w-24`} /> : (part.sku || '—')}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isEditing ? <input type="number" min="0" step="1" value={draft.onHand} onChange={(e) => setDraft((prev) => ({ ...prev, onHand: e.target.value }))} className={`${inputClass} w-20 text-right`} /> : part.onHand}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isEditing ? <input type="number" min="0" step="1" value={draft.reorderPoint} onChange={(e) => setDraft((prev) => ({ ...prev, reorderPoint: e.target.value }))} className={`${inputClass} w-20 text-right`} /> : part.reorderPoint}
                        </td>
                        <td className={`px-3 py-2 font-semibold ${isLow ? 'text-amber-300' : 'text-teal-300'}`}>{isLow ? 'Reorder' : 'OK'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <button type="button" disabled={saving} onClick={() => saveEdit(part)} className="rounded-xl bg-teal-600 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-500 transition disabled:opacity-50">Save</button>
                              <button type="button" onClick={() => setEditingId(null)} className="rounded-xl border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 transition">Cancel</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => startEdit(part)} className="rounded-xl border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 transition">Edit</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
