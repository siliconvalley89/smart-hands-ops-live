import { doc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db, auth } from '../firebase';
import { Wrench, Clock, MapPin, Trash2, List, CheckCircle, Plus, FileText, Shield, Download } from 'lucide-react';
import { formatSchedule, getJobStatusLabel } from '../lib/jobTime';
import { downloadInvoice } from '../lib/invoice';
import { calcInvoiceTotal } from '../lib/invoiceTotals';
import { getReceivableStatus } from '../lib/payments';
import { formatSlaLabel, getResponseSla } from '../lib/sla';
import { isFieldRole } from '../lib/roles';
import { formatDate, getPhotoCount, getCheckoutBlockReason, getBreakReturnTime, getBreakStartBlock, isOnBreak } from '../lib/jobDisplay';
import TechNameWithPhoto from './TechNameWithPhoto';
import JobMedia from './JobMedia';
import PayBalanceButton from './PayBalanceButton';
import RescheduleRequestForm from './RescheduleRequestForm';

export default function ActiveJobs({
  profile,
  parts,
  showJobsPanel,
  setShowJobsPanel,
  jobSearch,
  setJobSearch,
  jobStatusFilter,
  setJobStatusFilter,
  loading,
  activeJobs,
  filteredActiveJobs,
  activeMatchCount,
  onLoadMoreActive,
  expandedJobIds,
  setExpandedJobIds,
  detailsReady,
  editingJobId,
  setEditingJobId,
  jobEdits,
  setJobEdits,
  jobPayments,
  techs,
  uploadingId,
  uploadingFilesId,
  consumableEdits,
  newConsumable,
  setNewConsumable,
  serviceFeeInputs,
  setServiceFeeInputs,
  assignments,
  setAssignments,
  canViewInvoice,
  canEditConsumables,
  canDownloadPhotos,
  canStaffManage,
  geoEventBusyJobId,
  setAppError,
  downloadPhotos,
  deletePhoto,
  handlePhotoUpload,
  handleAttachmentUpload,
  deleteAttachment,
  updateConsumableField,
  saveConsumableChange,
  deleteConsumable,
  addConsumable,
  addServiceFee,
  deleteServiceFee,
  assignTechnicianToJob,
  saveJobEdits,
  recordTechGeoEvent,
  requestClientSignoff,
  handleClientSignoff,
  adminSignOffWork,
  handleDelete,
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Active jobs</h2>

          <p className="text-slate-400 text-sm mt-1">Jobs currently in progress or awaiting dispatch.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowJobsPanel((prev) => !prev)}
            className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
          >
            {showJobsPanel ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {showJobsPanel && (
      <div className="grid gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Search client, location, task, tech…"
            value={jobSearch}
            onChange={(e) => setJobSearch(e.target.value)}
            className="flex-1 rounded-2xl bg-slate-800 border border-slate-600 px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
          />
          <div className="flex flex-wrap gap-2">
            {['All', 'Pending', 'Assigned', 'Dispatched', 'On Site', 'Ready for Signoff'].map((s) => (
              <button
                key={s}
                onClick={() => setJobStatusFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  jobStatusFilter === s
                    ? 'bg-teal-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      {loading ? (
        <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">Loading jobs…</div>
      ) : filteredActiveJobs.length === 0 ? (
        <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">{activeJobs.length === 0 ? 'No active jobs.' : 'No jobs match your filter.'}</div>
      ) : (
        <div className="space-y-6">
          {filteredActiveJobs.map((job) => {
            const total = calcInvoiceTotal(job.consumables || [], job.serviceFee);
            const receivable = getReceivableStatus(job, jobPayments[job.id] || []);
            const beforeReady = getPhotoCount(job, 'before') > 0;
            const afterReady = getPhotoCount(job, 'after') > 0;
            const canRequestSignoff = isFieldRole(profile.role) && ['Assigned', 'Dispatched', 'En Route', 'On Site'].includes(job.status) && beforeReady && afterReady && Boolean(job.checkInAt);
            const sla = profile.role !== 'client' ? getResponseSla(job, now) : null;
            const onBreak = isOnBreak(job);
            const canClientSignoff = profile.role === 'client' && job.status === 'Ready for Signoff' && !job.clientSignedOff;

            const isExpanded = expandedJobIds.includes(job.id);
            const toggleExpanded = () => setExpandedJobIds((prev) => (prev.includes(job.id) ? prev.filter((id) => id !== job.id) : [...prev, job.id]));

            if (!isExpanded) {
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={toggleExpanded}
                  className="w-full text-left bg-slate-800 rounded-2xl border border-slate-700 px-5 py-3 hover:bg-slate-700/60 transition flex flex-wrap items-center gap-x-4 gap-y-1"
                >
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] ${job.status === 'Ready for Signoff' ? 'bg-orange-500/10 text-orange-300' : 'bg-teal-500/10 text-teal-300'}`}>
                    {getJobStatusLabel(job)}
                  </span>
                  {sla && <span className={`inline-flex rounded-full px-3 py-1 text-xs ${sla.breached ? 'bg-rose-500/10 text-rose-300' : 'bg-amber-500/10 text-amber-300'}`}>{formatSlaLabel(sla)}</span>}
                  <span className="font-semibold text-white">{job.client}</span>
                  <span className="text-slate-300 text-sm truncate max-w-xs">{job.task}</span>
                  <span className="text-slate-400 text-sm">{job.assignedTechName || 'Unassigned'}</span>
                  {job.scheduledFor && <span className="text-amber-300 text-sm">{formatSchedule(job)}</span>}
                  <span className="ml-auto text-xs text-slate-400">Expand</span>
                </button>
              );
            }

            if (!detailsReady[job.id]) {
              return (
                <div key={job.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5 flex items-center justify-between gap-4">
                  <span className="text-slate-400 text-sm">Loading job details…</span>
                  <button type="button" onClick={toggleExpanded} className="rounded-xl border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 transition">Collapse</button>
                </div>
              );
            }

            return (
              <div key={job.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-400 mb-3">
                      <button type="button" onClick={toggleExpanded} className="mr-2 rounded-xl border border-slate-600 px-2 py-1 text-xs normal-case tracking-normal text-slate-300 hover:bg-slate-700 transition">Collapse</button>
                      <span className={`inline-flex rounded-full px-3 py-1 ${job.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-300' : job.status === 'Ready for Signoff' ? 'bg-orange-500/10 text-orange-300' : 'bg-teal-500/10 text-teal-300'}`}>
                        {getJobStatusLabel(job)}
                      </span>
                      {sla && <span className={`inline-flex rounded-full px-3 py-1 text-xs ${sla.breached ? 'bg-rose-500/10 text-rose-300' : 'bg-amber-500/10 text-amber-300'}`}>{formatSlaLabel(sla)}</span>}
                      {profile.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => setEditingJobId((prev) => prev === job.id ? null : job.id)}
                          className="ml-2 inline-flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 transition"
                        >
                          <Wrench size={12} /> {editingJobId === job.id ? 'Cancel edit' : 'Edit details'}
                        </button>
                      )}
                    </div>
                    {editingJobId === job.id ? (
                      <div className="grid gap-3 mt-2">
                        <input value={jobEdits[job.id]?.client ?? job.client ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], client: e.target.value } }))} placeholder="Client name" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                        <input value={jobEdits[job.id]?.clientPhone ?? job.clientPhone ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], clientPhone: e.target.value } }))} placeholder="Client phone" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                        <input value={jobEdits[job.id]?.clientEmail ?? job.clientEmail ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], clientEmail: e.target.value } }))} placeholder="Client email" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                        <input value={jobEdits[job.id]?.location ?? job.rawLocation ?? job.location ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], location: e.target.value, rawLocation: e.target.value } }))} placeholder="Location" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                        <input value={jobEdits[job.id]?.task ?? job.task ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], task: e.target.value } }))} placeholder="Service / task" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                        <input value={jobEdits[job.id]?.serialNumber ?? job.serialNumber ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], serialNumber: e.target.value } }))} placeholder="Serial number" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 font-mono" />
                        <input value={jobEdits[job.id]?.details ?? job.details ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], details: e.target.value } }))} placeholder="Fault / details" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                        <button type="button" onClick={() => saveJobEdits(job)} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition">Save changes</button>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-xl font-semibold text-white">{job.client}</h2>
                        <p className="text-slate-400 mt-2">{job.location}</p>
                        <p className="text-slate-300 mt-3">{job.task}</p>
                        {job.serialNumber && (
                          <p className="text-slate-300 mt-2 font-mono text-sm">S/N: <span className="text-amber-300">{job.serialNumber}</span></p>
                        )}
                        {job.details && <p className="text-slate-400 mt-2">{job.details}</p>}
                      </>
                    )}
                  </div>
                  <div className="space-y-2 text-right">
                    <div className="text-slate-400 text-sm">Assigned tech</div>
                    <TechNameWithPhoto job={job} techs={techs} />
                    {(job.assignedTechDistanceMiles ?? job.assignedTechDistanceKm) != null && (
                      <div className="text-slate-400 text-sm">{(job.assignedTechDistanceMiles ?? job.assignedTechDistanceKm).toFixed(1)} mi away</div>
                    )}
                    {job.scheduledFor && (
                      <div>
                        <div className="text-slate-400 text-sm mt-3">Scheduled for</div>
                        <div className="text-amber-300 text-sm font-semibold">{formatSchedule(job)}</div>
                      </div>
                    )}
                    <div className="text-slate-400 text-sm mt-3">Created</div>
                    <div className="text-slate-200 text-sm">{formatDate(job.createdAt)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                  <div className="rounded-3xl bg-slate-950/40 border border-slate-700 p-4">
                    <JobMedia
                      job={job}
                      profile={profile}
                      now={now}
                      uploadingPhotos={uploadingId === job.id}
                      uploadingFiles={uploadingFilesId === job.id}
                      canDownloadPhotos={canDownloadPhotos}
                      downloadPhotos={downloadPhotos}
                      deletePhoto={deletePhoto}
                      handlePhotoUpload={handlePhotoUpload}
                      deleteAttachment={deleteAttachment}
                      handleAttachmentUpload={handleAttachmentUpload}
                    />
                  </div>

                  <div className="rounded-3xl bg-slate-950/40 border border-slate-700 p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-400 uppercase tracking-[0.18em] mb-4"><List size={16} /> Consumables</div>
                    <div className="space-y-3">
                      {(job.consumables || []).length === 0 ? (
                        <div className="text-slate-500">No consumables yet.</div>
                      ) : (
                        <div className="space-y-2">
                          {job.consumables.map((item) => {
                            const edit = consumableEdits[job.id]?.[item.id] || {};
                            const itemDescription = edit.description ?? item.description;
                            const itemQty = edit.qty ?? item.qty;
                            const itemUnitPrice = edit.unitPrice ?? item.unitPrice;
                            const hasPendingEdit = Object.keys(edit).length > 0;
                            return (
                              <div key={item.id} className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                                <div className="flex flex-col gap-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      {job.invoiceSent || !canEditConsumables ? (
                                        <p className="text-slate-100">{item.description}</p>
                                      ) : (
                                        <input
                                          value={itemDescription}
                                          onChange={(e) => updateConsumableField(job.id, item.id, 'description', e.target.value)}
                                          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                        />
                                      )}
                                      <p className="text-slate-500 text-sm">Qty: {itemQty}</p>
                                    </div>
                                    {canViewInvoice && (
                                      <div className="text-right text-slate-200">
                                        <div>${Number(itemUnitPrice).toFixed(2)} each</div>
                                        <div className="text-slate-400 text-sm">${(Number(itemQty) * Number(itemUnitPrice)).toFixed(2)}</div>
                                      </div>
                                    )}
                                  </div>
                                  {!job.invoiceSent && canEditConsumables && (
                                    <div className={`grid gap-2 ${profile.role === 'admin' ? 'sm:grid-cols-[1fr_auto_auto]' : 'sm:grid-cols-[1fr_auto]'}`}>
                                      <input
                                        type="number"
                                        min="1"
                                        value={itemQty}
                                        onChange={(e) => updateConsumableField(job.id, item.id, 'qty', e.target.value)}
                                        className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                      />
                                      {profile.role === 'admin' && (
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          value={itemUnitPrice}
                                          onChange={(e) => updateConsumableField(job.id, item.id, 'unitPrice', e.target.value)}
                                          className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                        />
                                      )}
                                      <button
                                        onClick={() => saveConsumableChange(job, item.id)}
                                        disabled={!hasPendingEdit}
                                        className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${hasPendingEdit ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}
                                      >
                                        Save
                                      </button>
                                    </div>
                                  )}
                                  {!job.invoiceSent && canEditConsumables && (
                                    <button
                                      onClick={() => deleteConsumable(job, item.id)}
                                      className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {canEditConsumables && (
                      <div className="mt-4 space-y-3">
                        {parts.length > 0 && (
                          <select
                            value={newConsumable.partId}
                            onChange={(e) => {
                              const part = parts.find((item) => item.id === e.target.value);
                              setNewConsumable((prev) => ({
                                ...prev,
                                partId: e.target.value,
                                description: part ? part.name : prev.description,
                              }));
                            }}
                            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                          >
                            <option value="">Not from inventory</option>
                            {parts.map((part) => (
                              <option key={part.id} value={part.id}>{part.name} ({part.onHand} on hand)</option>
                            ))}
                          </select>
                        )}
                        <input
                          value={newConsumable.description}
                          onChange={(e) => setNewConsumable((prev) => ({ ...prev, description: e.target.value }))}
                          placeholder="Item description"
                          className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                        />
                        <div className={`grid gap-3 ${profile.role === 'admin' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          <input
                            type="number"
                            min="1"
                            value={newConsumable.qty}
                            onChange={(e) => setNewConsumable((prev) => ({ ...prev, qty: e.target.value }))}
                            placeholder="Qty"
                            className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                          />
                          {profile.role === 'admin' && (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={newConsumable.unitPrice}
                              onChange={(e) => setNewConsumable((prev) => ({ ...prev, unitPrice: e.target.value }))}
                              placeholder="Unit price"
                              className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                            />
                          )}
                        </div>
                        <button onClick={() => addConsumable(job)} className="w-full rounded-2xl bg-teal-600 px-4 py-3 text-white font-semibold hover:bg-teal-500 transition flex items-center justify-center gap-2">
                          <Plus size={16} /> Add consumable
                        </button>
                      </div>
                    )}
                    {(job.serviceFee || job.serviceFee === 0) && canViewInvoice && (
                      <div className="mt-4 rounded-2xl bg-slate-900 p-3 border border-slate-700 text-slate-200">
                        <div className="text-slate-400 text-sm">Service fee</div>
                        <div className="font-semibold text-slate-100">${Number(job.serviceFee || 0).toFixed(2)}</div>
                        {job.serviceFeeDescription && (
                          <div className="text-slate-400 text-sm mt-2">{job.serviceFeeDescription}</div>
                        )}
                      </div>
                    )}
                    {!job.invoiceSent && profile?.role === 'admin' && (
                      <div className="mt-4 space-y-3">
                        <div className="text-slate-400 text-sm">Admin service management</div>
                        <input
                          type="text"
                          value={serviceFeeInputs[job.id]?.description ?? job.serviceFeeDescription ?? ''}
                          onChange={(e) => setServiceFeeInputs((prev) => ({
                            ...prev,
                            [job.id]: {
                              ...prev[job.id],
                              description: e.target.value,
                            },
                          }))}
                          placeholder="Service fee description"
                          className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={serviceFeeInputs[job.id]?.amount ?? (job.serviceFee != null ? String(job.serviceFee) : '')}
                          onChange={(e) => setServiceFeeInputs((prev) => ({
                            ...prev,
                            [job.id]: {
                              ...prev[job.id],
                              amount: e.target.value,
                            },
                          }))}
                          placeholder="Service fee amount"
                          className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <button onClick={() => addServiceFee(job)} className="w-full rounded-2xl bg-violet-600 px-4 py-3 text-white font-semibold hover:bg-violet-500 transition flex items-center justify-center gap-2">
                            <Plus size={16} /> Add / update service fee
                          </button>
                          <button onClick={() => deleteServiceFee(job)} className="w-full rounded-2xl bg-rose-600 px-4 py-3 text-white font-semibold hover:bg-rose-500 transition">
                            Delete service fee
                          </button>
                        </div>
                      </div>
                    )}
                    {canViewInvoice && (
                      <div className="mt-4 rounded-2xl bg-slate-900 p-4 border border-slate-700">
                        <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                          <span>Total</span>
                          <span className="font-semibold text-slate-100">${total.toFixed(2)}</span>
                        </div>
                        {job.invoiceSent && (
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
                        )}
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                          <PayBalanceButton job={job} role={profile.role} balance={receivable.balance} />
                          {job.status !== 'Pending' && (
                            profile.role === 'admin' || job.adminSignedOff ? (
                              <button onClick={() => downloadInvoice(job, profile.role, setAppError)} className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition">
                                Download invoice
                              </button>
                            ) : null
                          )}
                        </div>
                      </div>
                    )}
                    {canStaffManage && job.status !== 'Completed' && (
                      <div className="mt-4 rounded-2xl bg-slate-950/80 border border-slate-700 p-4">
                        <div className="text-slate-400 text-sm mb-3">Assign or reassign technician</div>
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                          <select
                            value={assignments[job.id] || ''}
                            onChange={(e) => setAssignments((prev) => ({ ...prev, [job.id]: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                          >
                            <option value="">Select technician</option>
                            {techs.map((tech) => (
                              <option key={tech.id} value={tech.id}>
                                {tech.name} {tech.status === 'busy' ? '(busy)' : '(available)'}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => assignTechnicianToJob(job)}
                            className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition"
                          >
                            Assign / Reassign
                          </button>
                        </div>
                        <div className="text-slate-500 text-xs mt-2">Use this to assign or reassign the job when auto-dispatch does not match the field requirements.</div>
                      </div>
                    )}
                  </div>
                </div>

                {profile.role === 'client' && ['Pending', 'Assigned', 'Dispatched'].includes(job.status) && (
                  <RescheduleRequestForm job={job} />
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2 text-slate-400 text-sm">
                    {job.clientPhone && <div>Phone: {job.clientPhone}</div>}
                    {job.clientEmail && <div>Email: {job.clientEmail}</div>}
                    {job.checkInAt && <div>Check-in: {formatDate(job.checkInAt)}</div>}
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
                    {(job.breaks || []).map((brk, idx) => {
                      const durationMs = brk.endAt
                        ? (brk.endAt?.toDate ? brk.endAt.toDate() : new Date(brk.endAt)) - (brk.startAt?.toDate ? brk.startAt.toDate() : new Date(brk.startAt))
                        : null;
                      const durationMin = durationMs != null ? Math.round(durationMs / 60000) : null;
                      const short = durationMin != null && durationMin < 30;
                      return (
                        <div key={idx} className={short ? 'text-red-400' : ''}>
                          Break {idx + 1}: out {formatDate(brk.startAt)}{brk.endAt ? ` → back ${formatDate(brk.endAt)} (${durationMin} min${short ? ' ⚠ under 30 min' : ''})` : ' · on break'}
                        </div>
                      );
                    })}
                    {job.checkOutAt && <div>Check-out: {formatDate(job.checkOutAt)} ({Number(job.checkOutLat || 0).toFixed(5)}, {Number(job.checkOutLng || 0).toFixed(5)})</div>}
                    {job.clientSignedOff && <div className="text-emerald-300">Client signed off</div>}
                    {job.adminSignedOff && <div className="text-teal-300">Admin signed off{job.adminSignedOffAt ? ` · ${formatDate(job.adminSignedOffAt)}` : ''}</div>}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {isFieldRole(profile.role) && !job.checkInAt && job.status !== 'En Route' && (
                      <button
                        onClick={() => updateDoc(doc(db, 'jobs', job.id), { status: 'En Route', statusUpdatedByRole: profile.role, enRouteAt: new Date(), updatedAt: new Date(), updatedBy: auth.currentUser?.email })}
                        className="rounded-2xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition flex items-center gap-2"
                      >
                        <MapPin size={16} /> Start en route
                      </button>
                    )}
                    {isFieldRole(profile.role) && !job.checkInAt && (
                      <button
                        onClick={() => recordTechGeoEvent(job, 'checkIn')}
                        disabled={geoEventBusyJobId === job.id}
                        className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 transition flex items-center gap-2 disabled:opacity-60"
                      >
                        <MapPin size={16} /> {geoEventBusyJobId === job.id ? 'Checking in...' : 'Check in on site'}
                      </button>
                    )}
                    {isFieldRole(profile.role) && job.checkInAt && !job.checkOutAt && (() => {
                      const hasActiveBreak = (job.breaks || []).some(b => b.startAt && !b.endAt);
                      const checkoutBlockReason = getCheckoutBlockReason(job);
                      const breakReturnAt = getBreakReturnTime(job);
                      const breakTooShort = breakReturnAt != null && now < breakReturnAt;
                      const breakStartBlock = getBreakStartBlock(job, now);
                      return hasActiveBreak ? (
                        <button
                          onClick={() => recordTechGeoEvent(job, 'breakEnd')}
                          disabled={geoEventBusyJobId === job.id || breakTooShort}
                          className="rounded-2xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <Clock size={16} /> {breakTooShort
                            ? `Back in at ${new Date(breakReturnAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                            : geoEventBusyJobId === job.id ? 'Clocking in...' : 'Clock back in from break'}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => recordTechGeoEvent(job, 'breakStart')}
                            disabled={geoEventBusyJobId === job.id || Boolean(breakStartBlock)}
                            className="rounded-2xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition flex items-center gap-2 disabled:opacity-60"
                          >
                            <Clock size={16} /> {geoEventBusyJobId === job.id ? 'Clocking out...' : breakStartBlock?.label || 'Start meal break'}
                          </button>
                          <button
                            onClick={() => recordTechGeoEvent(job, 'checkOut')}
                            disabled={geoEventBusyJobId === job.id || Boolean(checkoutBlockReason)}
                            className="rounded-2xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500 transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <MapPin size={16} /> {geoEventBusyJobId === job.id ? 'Checking out...' : 'Check out from site'}
                          </button>
                          {checkoutBlockReason && <span className="self-center text-xs text-amber-300">{checkoutBlockReason}</span>}
                        </>
                      );
                    })()}
                    {profile.role === 'admin' && !job.checkOutAt && (
                      <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(job.geofenceOverride)}
                          onChange={(e) => updateDoc(doc(db, 'jobs', job.id), { geofenceOverride: e.target.checked, updatedAt: new Date(), updatedBy: auth.currentUser?.email }).catch(() => setAppError('Unable to update site check-in override.'))}
                        />
                        Allow check-in from anywhere (remote job)
                      </label>
                    )}
                    {isFieldRole(profile.role) && canRequestSignoff && (
                      <button onClick={() => requestClientSignoff(job)} disabled={onBreak} className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                        <FileText size={16} /> Request sign-off
                      </button>
                    )}
                    {isFieldRole(profile.role) && canRequestSignoff && onBreak && (
                      <span className="self-center text-xs text-amber-300">Clock back in from break to request sign-off.</span>
                    )}
                    {profile.role === 'client' && canClientSignoff && (
                      <button onClick={() => handleClientSignoff(job)} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition flex items-center gap-2">
                        <CheckCircle size={16} /> Sign off work
                      </button>
                    )}
                    {profile.role === 'admin' && job.status === 'Ready for Signoff' && !job.adminSignedOff && (
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
            );
          })}
          {filteredActiveJobs.length < activeMatchCount && (
            <button
              type="button"
              onClick={onLoadMoreActive}
              className="w-full rounded-2xl border border-slate-600 px-4 py-3 text-sm text-slate-200 hover:bg-slate-700 transition"
            >
              Load more ({filteredActiveJobs.length} of {activeMatchCount})
            </button>
          )}
        </div>
      )}
      </div>
      )}
    </section>
  );
}
