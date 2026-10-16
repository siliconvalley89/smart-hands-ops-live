import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export default function VerifyBadge({ uid }) {
  const [state, setState] = useState({ status: 'loading', badge: null });

  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, 'badges', uid))
      .then((snap) => {
        if (!cancelled) setState({ status: snap.exists() ? 'active' : 'invalid', badge: snap.data() || null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', badge: null });
      });
    return () => { cancelled = true; };
  }, [uid]);

  const { status, badge } = state;
  const role = badge?.role === 'adminAssistant' ? 'Admin Assistant' : badge?.role;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Silicon Valley Smart Hands LLC</div>
        {status === 'loading' && <div className="mt-6 text-slate-300">Verifying...</div>}
        {status === 'active' && (
          <>
            <div className="mt-4 inline-block rounded-full bg-emerald-600 px-4 py-1 text-sm font-bold">ACTIVE STAFF BADGE</div>
            {badge.photoData && <img src={badge.photoData} alt="Staff" className="mx-auto mt-5 h-40 w-40 rounded-full object-cover ring-4 ring-amber-500" />}
            <div className="mt-4 text-2xl font-bold">{badge.displayName}</div>
            <div className="mt-1 text-amber-400 font-semibold uppercase">{role}</div>
            <div className="mt-2 text-xs text-slate-500">ID: {uid.slice(0, 8).toUpperCase()}</div>
          </>
        )}
        {status === 'invalid' && (
          <>
            <div className="mt-4 inline-block rounded-full bg-red-600 px-4 py-1 text-sm font-bold">NOT VALID</div>
            <p className="mt-4 text-slate-300">This badge is not active or does not exist.</p>
          </>
        )}
        {status === 'error' && <p className="mt-6 text-red-300">Unable to verify right now. Please try again.</p>}
      </div>
    </div>
  );
}
