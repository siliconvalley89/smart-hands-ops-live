import { useMemo, useState } from 'react';
import Receivables from './Receivables';
import useReceivables, { RECENT_WINDOW_DAYS } from '../hooks/useReceivables';
import { summarizeReceivables } from '../lib/receivableSummary';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function ReceivablesSection({ showReceivablesPanel, setShowReceivablesPanel, recordedBy, setAppError }) {
  const [includeOlder, setIncludeOlder] = useState(false);
  const { rows, loading } = useReceivables({ includeOlder, setAppError });
  const summary = useMemo(() => summarizeReceivables(rows), [rows]);
  const scopeLabel = includeOlder ? 'all invoices' : `invoices from the last ${RECENT_WINDOW_DAYS} days`;

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Receivables</h2>
          <p className="text-slate-400 text-sm mt-1">Invoices awaiting payment, aging, and manual payment recording.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowReceivablesPanel((prev) => !prev)}
          className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
        >
          {showReceivablesPanel ? 'Collapse' : 'Expand'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
          <div className="text-slate-400 text-sm">Outstanding</div>
          <div className="text-2xl font-semibold text-slate-100">{loading ? '…' : money(summary.outstanding)}</div>
          <div className="text-slate-500 text-sm">{summary.openCount} open invoice(s)</div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
          <div className="text-slate-400 text-sm">Overdue</div>
          <div className="text-2xl font-semibold text-rose-300">{loading ? '…' : money(summary.overdueTotal)}</div>
          <div className="text-slate-500 text-sm">{summary.overdueCount} overdue invoice(s)</div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4 grid grid-cols-2 gap-2">
          {summary.buckets.map((bucket) => (
            <div key={bucket.value}>
              <div className="text-slate-400 text-xs">{bucket.label}</div>
              <div className="text-slate-100 font-semibold">{loading ? '…' : money(bucket.total)}</div>
              <div className="text-slate-500 text-xs">{bucket.count} invoice(s)</div>
            </div>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-slate-300 text-sm">
        <input type="checkbox" checked={includeOlder} onChange={(e) => setIncludeOlder(e.target.checked)} />
        Include invoices older than {RECENT_WINDOW_DAYS} days
        <span className="text-slate-500">(showing {scopeLabel})</span>
      </label>

      {showReceivablesPanel && <Receivables rows={rows} recordedBy={recordedBy} />}
    </section>
  );
}
