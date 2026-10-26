import { useEffect, useMemo, useState } from 'react';
import { Timestamp, collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { getReceivableStatus } from '../lib/payments';

export const RECENT_WINDOW_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const toDocs = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

export default function useReceivables({ includeOlder, setAppError }) {
  const [sentJobs, setSentJobs] = useState([]);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [billingByJob, setBillingByJob] = useState({});
  const [consumablesByJob, setConsumablesByJob] = useState({});
  const [paymentsByJob, setPaymentsByJob] = useState({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const cutoff = includeOlder ? null : Timestamp.fromMillis(Date.now() - RECENT_WINDOW_DAYS * DAY_MS);
    const windowed = (constraint) => query(collection(db, 'jobs'), constraint, ...(cutoff ? [where('createdAt', '>=', cutoff)] : []));
    const onError = (label) => (error) => {
      console.error(`Receivables ${label} listener failed`, error);
      setAppError('Unable to load receivables data.');
    };
    const unsubscribes = [
      onSnapshot(windowed(where('invoiceSent', '==', true)), (snapshot) => setSentJobs(toDocs(snapshot)), onError('invoiced jobs')),
      onSnapshot(windowed(where('status', '==', 'Completed')), (snapshot) => setCompletedJobs(toDocs(snapshot)), onError('completed jobs')),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [includeOlder, setAppError]);

  const jobs = useMemo(() => {
    const byId = new Map();
    [...sentJobs, ...completedJobs].forEach((job) => byId.set(job.id, job));
    return [...byId.values()];
  }, [sentJobs, completedJobs]);
  const jobIdsKey = jobs.map((job) => job.id).sort().join('|');

  useEffect(() => {
    const jobIds = jobIdsKey ? jobIdsKey.split('|') : [];
    const subscriptions = jobIds.flatMap((jobId) => [
      onSnapshot(
        doc(db, 'jobBilling', jobId),
        (snapshot) => setBillingByJob((prev) => ({ ...prev, [jobId]: snapshot.exists() ? snapshot.data() : {} })),
        (error) => {
          console.error(`Unable to load billing data for job ${jobId}`, error);
          setAppError('Unable to load receivables data.');
        },
      ),
      onSnapshot(
        collection(db, 'jobs', jobId, 'consumables'),
        (snapshot) => setConsumablesByJob((prev) => ({ ...prev, [jobId]: toDocs(snapshot) })),
        (error) => {
          console.error(`Unable to load consumables for job ${jobId}`, error);
          setAppError('Unable to load receivables data.');
        },
      ),
      onSnapshot(
        collection(db, 'jobs', jobId, 'payments'),
        (snapshot) => setPaymentsByJob((prev) => ({ ...prev, [jobId]: toDocs(snapshot) })),
        (error) => {
          console.error(`Unable to load payments for job ${jobId}`, error);
          setAppError('Unable to load receivables data.');
        },
      ),
    ]);
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [jobIdsKey, setAppError]);

  const rows = useMemo(() => jobs.map((job) => {
    const billing = billingByJob[job.id] || {};
    const consumables = (consumablesByJob[job.id] || []).map((item) => ({
      ...item,
      unitPrice: billing.consumablePrices?.[item.id] ?? 0,
    }));
    const merged = { ...job, ...billing, consumables };
    const payments = paymentsByJob[job.id] || [];
    return { job: merged, payments, receivable: getReceivableStatus(merged, payments, nowMs) };
  }), [jobs, billingByJob, consumablesByJob, paymentsByJob, nowMs]);

  const loading = jobs.some((job) => !(job.id in billingByJob) || !(job.id in paymentsByJob) || !(job.id in consumablesByJob));

  return { rows, loading };
}
