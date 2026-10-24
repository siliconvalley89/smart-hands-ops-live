import { Calendar } from 'lucide-react';

export default function RequestForm({
  profile,
  requestFormOpen,
  setRequestFormOpen,
  requestForm,
  setRequestForm,
  requestError,
  requestSuccess,
  submitRequest,
}) {
  return (
    <section className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 text-lg font-semibold"><Calendar size={20} /> {profile.role === 'client' ? 'Request service' : 'Client request form'}</div>
        <button type="button" onClick={() => setRequestFormOpen((prev) => !prev)} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
          {requestFormOpen ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {requestFormOpen && <form onSubmit={submitRequest} className="grid gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-slate-300 text-sm">Name</span>
            <input
              value={requestForm.name}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Client name"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-slate-300 text-sm">Email</span>
            <input
              value={requestForm.email}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="client@example.com"
              readOnly={profile.role === 'client'}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
            />
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-slate-300 text-sm">Phone</span>
            <input
              value={requestForm.phone}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="(408) 409-8115"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-slate-300 text-sm">Location</span>
            <input
              value={requestForm.location}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, location: e.target.value }))}
              placeholder="123 Main St, San Jose, CA"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-slate-300 text-sm">Service requested</span>
          <input
            value={requestForm.service}
            onChange={(e) => setRequestForm((prev) => ({ ...prev, service: e.target.value }))}
            placeholder="Network repair, server install, etc."
            className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
          />
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-slate-300 text-sm">Hardware serial number</span>
            <input
              value={requestForm.serialNumber}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, serialNumber: e.target.value }))}
              placeholder="e.g. SRV-2A4F8B"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 font-mono"
            />
          </label>
          <label className="block">
            <span className="text-slate-300 text-sm">Failure / fault details</span>
            <input
              value={requestForm.details}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, details: e.target.value }))}
              placeholder="Power supply failed, NIC unreachable, etc."
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
            />
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-slate-300 text-sm">Scheduled date &amp; start time <span className="text-slate-500 text-xs">(optional, leave blank for immediate dispatch)</span></span>
            <input
              type="datetime-local"
              value={requestForm.scheduledFor}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, scheduledFor: e.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-slate-300 text-sm">End time <span className="text-slate-500 text-xs">(earlier than start = next day)</span></span>
            <input
              type="time"
              value={requestForm.scheduledEndTime}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, scheduledEndTime: e.target.value }))}
              disabled={!requestForm.scheduledFor}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 disabled:opacity-50"
            />
          </label>
        </div>
        {requestError && <div className="rounded-2xl bg-red-900/50 p-3 text-red-200">{requestError}</div>}
        {requestSuccess && <div className="rounded-2xl bg-emerald-900/50 p-3 text-emerald-200">{requestSuccess}</div>}
        <button type="submit" className="rounded-2xl bg-teal-600 px-5 py-3 text-white font-semibold hover:bg-teal-500 transition">
          Submit request
        </button>
      </form>}
    </section>
  );
}
