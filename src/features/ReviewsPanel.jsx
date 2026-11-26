import { deleteDoc, doc, onSnapshot, collection, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { toMillis } from '../lib/jobTime';
import { formatPacific } from '../lib/pacificTime';

const stamp = (value) => formatPacific(value, { month: 'short', day: 'numeric', year: 'numeric' });

export default function ReviewsPanel({ email }) {
  const [pending, setPending] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const pendingQuery = query(collection(db, 'reviews'), where('status', '==', 'pending'));
    return onSnapshot(
      pendingQuery,
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        setPending(items.sort((a, b) => (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0)));
        setError('');
      },
      (err) => {
        console.error('Unable to load reviews', err);
        setError('Unable to load reviews.');
      },
    );
  }, []);

  const moderate = async (review, status) => {
    setBusyId(review.id);
    setError('');
    try {
      if (status === 'deleted') {
        await deleteDoc(doc(db, 'reviews', review.id));
      } else {
        await updateDoc(doc(db, 'reviews', review.id), { status, moderatedAt: serverTimestamp(), moderatedBy: email });
      }
    } catch (err) {
      console.error('Unable to update review', err);
      setError('Unable to update that review. Try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Website reviews awaiting approval</h2>
        <p className="text-slate-400 mt-1">Approved reviews appear on the website. Rejected reviews stay hidden.</p>
      </div>
      {error && <div className="rounded-2xl bg-rose-900/50 p-3 text-rose-200">{error}</div>}
      {pending.length === 0 ? (
        <div className="rounded-2xl bg-slate-900 p-4 text-slate-400">No reviews waiting for approval.</div>
      ) : (
        <div className="space-y-3">
          {pending.map((review) => (
            <div key={review.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-4 grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-100">
                  {review.name}{review.company ? `, ${review.company}` : ''}
                </div>
                <div className="text-sm text-amber-300">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</div>
              </div>
              <p className="text-slate-300 whitespace-pre-wrap">{review.text}</p>
              <div className="text-xs text-slate-500">Submitted {review.createdAt ? stamp(toMillis(review.createdAt)) : 'just now'}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" disabled={busyId === review.id} onClick={() => moderate(review, 'approved')} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Approve</button>
                <button type="button" disabled={busyId === review.id} onClick={() => moderate(review, 'rejected')} className="rounded-2xl bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500 disabled:opacity-50">Reject</button>
                <button type="button" disabled={busyId === review.id} onClick={() => moderate(review, 'deleted')} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
