import { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, getCountFromServer, query, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../firebase';
import { isFieldRole } from '../lib/roles';

const scopedCompletedConstraints = (profile, firebaseUser) => {
  const email = profile?.email || firebaseUser?.email || '';
  if (isFieldRole(profile?.role)) return [where('assignedTechEmail', '==', email), where('billingMigrated', '==', true), where('status', '==', 'Completed')];
  if (profile?.role === 'client') return [where('clientEmail', '==', email), where('status', '==', 'Completed')];
  return [where('status', '==', 'Completed')];
};

export default function useJobs({ profile, firebaseUser, sessionRestoreCount, showCompletedJobsPanel, completedLimit, setAppError, suppressAuthStateRef }) {
  const [jobs, setJobs] = useState([]);
  const [jobBilling, setJobBilling] = useState({});
  const [jobPayments, setJobPayments] = useState({});
  const [jobConsumables, setJobConsumables] = useState({});
  const [loading, setLoading] = useState(true);
  const [completedJobsData, setCompletedJobsData] = useState([]);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [completedTotal, setCompletedTotal] = useState(0);

  useEffect(() => {
    if (!profile?.role) return () => {};

    // Only open jobs are streamed live; completed jobs are loaded on demand in pages
    let jobsQuery;
    // Security rules cannot be evaluated per-document for list queries, so tech/assistant queries must filter on billingMigrated
    if (profile.role === 'admin') {
      jobsQuery = query(collection(db, 'jobs'), where('status', '!=', 'Completed'));
    } else if (profile.role === 'adminAssistant') {
      jobsQuery = query(collection(db, 'jobs'), where('billingMigrated', '==', true), where('status', '!=', 'Completed'));
    } else if (isFieldRole(profile.role)) {
      jobsQuery = query(collection(db, 'jobs'), where('assignedTechEmail', '==', profile.email || firebaseUser?.email || ''), where('billingMigrated', '==', true), where('status', '!=', 'Completed'));
    } else {
      jobsQuery = query(collection(db, 'jobs'), where('clientEmail', '==', profile.email || firebaseUser?.email || ''), where('status', '!=', 'Completed'));
    }

    const unsubscribe = onSnapshot(
      jobsQuery,
      (snapshot) => {
        const toTime = (value) => {
          if (!value) return 0;
          if (value?.toDate) return value.toDate().getTime();
          const parsed = new Date(value).getTime();
          return Number.isNaN(parsed) ? 0 : parsed;
        };

        const jobItems = snapshot.docs
          .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
          .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));

        setJobs(jobItems);
        setLoading(false);
      },
      (error) => {
        console.error('Unable to load jobs snapshot', error);
        setJobs([]);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
      setLoading(true);
    };
  }, [profile?.role, profile?.email, firebaseUser?.email, sessionRestoreCount]);

  // Closed-jobs total via a cheap server-side count; refreshed whenever the open set changes size
  useEffect(() => {
    if (!profile?.role || profile.role === 'adminAssistant') return;
    getCountFromServer(query(collection(db, 'jobs'), ...scopedCompletedConstraints(profile, firebaseUser)))
      .then((snap) => setCompletedTotal(snap.data().count))
      .catch((error) => console.error('Unable to count completed jobs', error));
  }, [profile, firebaseUser, jobs.length]);

  // Completed jobs: subscribe only while the panel is expanded, newest first, one page at a time
  useEffect(() => {
    if (!profile?.role || profile.role === 'adminAssistant' || !showCompletedJobsPanel) return () => {};
    const completedQuery = query(
      collection(db, 'jobs'),
      ...scopedCompletedConstraints(profile, firebaseUser),
      orderBy('createdAt', 'desc'),
      limit(completedLimit),
    );
    const unsubscribe = onSnapshot(
      completedQuery,
      (snapshot) => {
        setCompletedJobsData(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
        setCompletedLoading(false);
      },
      (error) => {
        console.error('Unable to load completed jobs', error);
        setCompletedLoading(false);
      }
    );
    return () => {
      unsubscribe();
      setCompletedLoading(true);
    };
  }, [profile, firebaseUser, showCompletedJobsPanel, completedLimit, sessionRestoreCount]);

  const observedJobIds = [...new Set([...jobs, ...completedJobsData].map((job) => job.id))].sort();
  const observedJobIdsKey = observedJobIds.join('|');

  useEffect(() => {
    if (!profile?.role) return () => {};
    const jobIds = observedJobIdsKey ? observedJobIdsKey.split('|') : [];
    const subscriptions = [];

    jobIds.forEach((jobId) => {
      subscriptions.push(onSnapshot(
        collection(db, 'jobs', jobId, 'consumables'),
        (snapshot) => {
          setJobConsumables((prev) => ({
            ...prev,
            [jobId]: snapshot.docs.map((itemDoc) => ({ ...itemDoc.data(), id: itemDoc.id })),
          }));
        },
        (error) => {
          console.error(`Unable to load consumables for job ${jobId}`, error);
          // Access is lost when a job is reassigned or completed; the jobs listener removes it shortly after
          if (error?.code === 'permission-denied') {
            setJobConsumables((prev) => ({ ...prev, [jobId]: [] }));
            return;
          }
          if (!suppressAuthStateRef.current) setAppError('Unable to load job consumables.');
        },
      ));

      if (profile.role === 'admin' || profile.role === 'client') {
        subscriptions.push(onSnapshot(
          doc(db, 'jobBilling', jobId),
          (snapshot) => {
            setJobBilling((prev) => ({
              ...prev,
              [jobId]: snapshot.exists() ? snapshot.data() : {},
            }));
          },
          (error) => {
            console.error(`Unable to load billing data for job ${jobId}`, error);
            if (!suppressAuthStateRef.current) setAppError('Unable to load job billing data.');
          },
        ));

        subscriptions.push(onSnapshot(
          collection(db, 'jobs', jobId, 'payments'),
          (snapshot) => {
            setJobPayments((prev) => ({
              ...prev,
              [jobId]: snapshot.docs.map((paymentDoc) => ({ ...paymentDoc.data(), id: paymentDoc.id })),
            }));
          },
          (error) => {
            console.error(`Unable to load payments for job ${jobId}`, error);
          },
        ));
      }
    });

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      setJobBilling({});
      setJobPayments({});
      setJobConsumables({});
    };
  }, [observedJobIdsKey, profile?.role, sessionRestoreCount, suppressAuthStateRef, setAppError]);

  const hasRole = Boolean(profile?.role);
  return {
    jobs: hasRole ? jobs : [],
    loading: hasRole && loading,
    jobBilling,
    jobPayments,
    jobConsumables,
    completedJobsData: hasRole ? completedJobsData : [],
    completedLoading: hasRole && completedLoading,
    completedTotal,
  };
}
