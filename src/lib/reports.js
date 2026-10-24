import { calcInvoiceTotal } from './invoiceTotals';
import { toMillis } from './jobTime';

const MINUTE_MS = 60 * 1000;
const money = (value) => Math.round(value * 100) / 100;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const locationKey = (job) => (job.location || '').trim().toLowerCase();

export const buildReport = (jobs, paymentsByJob = {}) => {
  const locationCounts = jobs.reduce((counts, job) => {
    const key = locationKey(job);
    if (key) counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  const jobRows = jobs.map((job) => {
    const payments = (paymentsByJob[job.id] || []).filter((payment) => !payment.voided);
    const signedOff = toMillis(job.adminSignedOffAt) != null;
    const invoiced = signedOff ? money(calcInvoiceTotal(job.consumables || [], job.serviceFee)) : 0;
    const collected = money(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    const created = toMillis(job.createdAt);
    const checkIn = toMillis(job.checkInAt);
    const key = locationKey(job);
    return {
      jobId: job.id,
      createdAt: created == null ? '' : new Date(created).toISOString(),
      techName: job.assignedTechName || '',
      client: job.client || '',
      location: job.location || '',
      status: job.status || '',
      invoiced,
      collected,
      outstanding: money(Math.max(0, invoiced - collected)),
      responseMinutes: created != null && checkIn != null && checkIn >= created ? Math.round((checkIn - created) / MINUTE_MS) : null,
      repeatVisit: Boolean(key) && locationCounts[key] > 1,
      signedOff,
    };
  });

  const techTotals = {};
  jobRows.forEach((row) => {
    const name = row.techName || 'Unassigned';
    if (!techTotals[name]) techTotals[name] = { name, jobs: 0, completed: 0 };
    techTotals[name].jobs += 1;
    if (row.status === 'Completed') techTotals[name].completed += 1;
  });

  const responseTimes = jobRows.map((row) => row.responseMinutes).filter((value) => value != null);
  const repeatJobs = jobRows.filter((row) => row.repeatVisit).length;

  return {
    jobCount: jobRows.length,
    signedOffCount: jobRows.filter((row) => row.signedOff).length,
    invoiced: money(jobRows.reduce((sum, row) => sum + row.invoiced, 0)),
    collected: money(jobRows.reduce((sum, row) => sum + row.collected, 0)),
    outstanding: money(jobRows.reduce((sum, row) => sum + row.outstanding, 0)),
    medianResponseMinutes: median(responseTimes),
    repeatJobs,
    repeatRate: jobRows.length ? repeatJobs / jobRows.length : null,
    byTech: Object.values(techTotals).sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name)),
    jobRows,
  };
};

export const REPORT_JOB_HEADER = [
  'Created', 'Job ID', 'Tech', 'Client', 'Location', 'Status', 'Invoiced', 'Collected', 'Outstanding', 'Response (min)', 'Repeat visit',
];

export const reportCsvRows = (report) => [
  REPORT_JOB_HEADER,
  ...report.jobRows.map((row) => [
    row.createdAt, row.jobId, row.techName, row.client, row.location, row.status,
    row.invoiced.toFixed(2), row.collected.toFixed(2), row.outstanding.toFixed(2),
    row.responseMinutes, row.repeatVisit ? 'Yes' : 'No',
  ]),
];
