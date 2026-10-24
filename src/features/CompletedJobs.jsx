import { Shield, Trash2 } from 'lucide-react';
import TechNameWithPhoto from './TechNameWithPhoto';
import CompletedJobPhotos from './CompletedJobPhotos';
import { formatDate, getPhotoCount } from '../lib/jobDisplay';
import { calcInvoiceTotal, generateInvoicePdf } from '../lib/invoice';
import { getReceivableStatus } from '../lib/payments';

export default function CompletedJobs({
  profile,
  loading,
  completedLoading,
  completedJobs,
  filteredCompletedJobs,
  completedSearch,
  setCompletedSearch,
  showCompletedJobsPanel,
  setShowCompletedJobsPanel,
  completedLimit,
  completedTotal,
  onLoadMore,
  techs,
  jobPayments,
  canViewInvoice,
  canDownloadPhotos,
  downloadPhotos,
  setAppError,
  adminSignOffWork,
  handleDelete,
}) {
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Completed jobs</h2>
          <p className="text-slate-400 text-sm mt-1">Jobs that have been signed off and closed.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCompletedJobsPanel((prev) => !prev)}
          className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
        >
          {showCompletedJobsPanel ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {showCompletedJobsPanel && (
        <div className="grid gap-6">
          <input
            type="text"
            placeholder="Search client, location, task, tech�"
            value={completedSearch}
            onChange={(e) => setCompletedSearch(e.target.value)}
            className="rounded-2xl bg-slate-800 border border-slate-600 px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
          />
          {loading || (completedLoading && completedJobs.length === 0) ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">Loading jobs...</div>
          ) : filteredCompletedJobs.length === 0 ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">{completedJobs.length === 0 ? 'No completed jobs yet.' : 'No loaded jobs match your search. Try loading more.'}</div>
          ) : (
            <div className="space-y-6">
              {filteredCompletedJobs.map((job) => (
                <div key={job.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-400 mb-3">
                        <span className="inline-flex rounded-full px-3 py-1 bg-emerald-500/10 text-emerald-300">{job.status}</span>
                      </div>
                      <h2 className="text-xl font-semibold text-white">{job.client}</h2>
                      <p className="text-slate-400 mt-2">{job.location}</p>
                      <p className="text-slate-300 mt-3">{job.task}</p>
                      {job.serialNumber && <p className="text-slate-300 mt-2 font-mono text-sm">S/N: <span className="text-amber-300">{job.serialNumber}</span></p>}
                      {job.details && <p className="text-slate-400 mt-2">{job.details}</p>}
                    </div>
                    <div className="space-y-2 text-right">
                      <div className="text-slate-400 text-sm">Assigned tech</div>
                      <TechNameWithPhoto job={job} techs={techs} />
                      <div className="text-slate-400 text-sm mt-3">Completed</div>
                      <div className="text-slate-200 text-sm">{formatDate(job.completedAt || job.createdAt)}</div>
                    </div>
                  </div>
                  {getPhotoCount(job, 'before') + getPhotoCount(job, 'after') > 0 && (
                    <CompletedJobPhotos job={job} canDownloadPhotos={canDownloadPhotos} downloadPhotos={downloadPhotos} />
                  )}
                  {canViewInvoice && (
                    <div className="mt-6 rounded-2xl bg-slate-900 p-4 border border-slate-700">
                      <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                        <span>Total</span>
                        <span className="font-semibold text-slate-100">${calcInvoiceTotal(job.consumables || [], job.serviceFee).toFixed(2)}</span>
                      </div>
                      {job.invoiceSent && (() => {
                        const receivable = getReceivableStatus(job, jobPayments[job.id] || []);
                        return (
                          <>
                            <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                              <span>Paid</span>
                              <span className="font-semibold text-slate-100">${receivable.paid.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm mb-2">
                              <span className="text-slate-400">Balance due</span>
                              <span className={`font-semibold ${receivable.balance > 0 ? 'text-amber-300' : 'text-teal-300'}`}>${receivable.balance.toFixed(2)} · {receivable.status}</span>
                            </div>
                          </>
                        );
                      })()}
                      {(profile.role === 'admin' || job.adminSignedOff) && (
                        <button onClick={() => generateInvoicePdf(job, setAppError)} className="mt-2 rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition">
                          Download invoice
                        </button>
                      )}
                    </div>
                  )}
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-2 text-slate-400 text-sm">
                      {job.clientPhone && <div>Phone: {job.clientPhone}</div>}
                      {job.clientEmail && <div>Email: {job.clientEmail}</div>}
                      {job.checkInAt && <div>Check-in: {formatDate(job.checkInAt)}</div>}
                      {job.checkOutAt && <div>Check-out: {formatDate(job.checkOutAt)}</div>}
                      {job.checkInLat && job.checkInLng && (
                        <div className="mt-2">
                          <div className="text-xs text-slate-500 mb-1">Tech check-in location</div>
                          <div className="rounded-2xl overflow-hidden border border-slate-600" style={{height: '180px'}}>
                            <iframe
                              title="Tech check-in location"
                              width="100%"
                              height="180"
                              loading="lazy"
                              src={`https://www.openstreetmap.org/export/embed.html?bbox=${job.checkInLng - 0.003},${job.checkInLat - 0.003},${job.checkInLng + 0.003},${job.checkInLat + 0.003}&layer=mapnik&marker=${job.checkInLat},${job.checkInLng}`}
                              style={{border: 0, display: 'block'}}
                            />
                          </div>
                          <a
                            href={`https://www.google.com/maps?q=${job.checkInLat},${job.checkInLng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-teal-400 hover:text-teal-300 mt-1 inline-block"
                          >
                            Open in Google Maps ?
                          </a>
                        </div>
                      )}
                      {job.clientSignedOff && <div className="text-emerald-300">Client signed off</div>}
                      {job.adminSignedOff && <div className="text-teal-300">Admin signed off{job.adminSignedOffAt ? ` � ${formatDate(job.adminSignedOffAt)}` : ''}</div>}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {profile.role === 'admin' && !job.adminSignedOff && (
                        <button onClick={() => adminSignOffWork(job)} className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition flex items-center gap-2">
                          <Shield size={16} /> Sign off work
                        </button>
                      )}
                      {profile.role === 'admin' && job.adminSignedOff && (
                        <div className="rounded-2xl bg-teal-500/10 px-4 py-2 text-sm text-teal-200 flex items-center gap-2"><Shield size={14} /> Admin signed off</div>
                      )}
                      {profile.role === 'admin' && (
                        <button onClick={() => handleDelete(job.id)} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition flex items-center gap-2">
                          <Trash2 size={16} /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {completedJobs.length >= completedLimit && completedJobs.length < completedTotal && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  className="w-full rounded-2xl border border-slate-600 px-4 py-3 text-sm text-slate-200 hover:bg-slate-700 transition"
                >
                  Load more ({completedJobs.length} of {completedTotal})
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
