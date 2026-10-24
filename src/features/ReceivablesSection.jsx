import Receivables from './Receivables';

export default function ReceivablesSection({ showReceivablesPanel, setShowReceivablesPanel, recordedBy, setAppError }) {
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
      {showReceivablesPanel && <Receivables recordedBy={recordedBy} setAppError={setAppError} />}
    </section>
  );
}
