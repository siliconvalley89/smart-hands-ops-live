import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { CreditCard } from 'lucide-react';
import { functions } from '../firebase';

export default function PayBalanceButton({ job, role, balance }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (role !== 'client' || job.billingMigrated !== true || job.invoiceSent !== true || !(balance > 0)) return null;

  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await httpsCallable(functions, 'createPaymentCheckout')({ jobId: job.id });
      window.location.assign(data.url);
    } catch (err) {
      console.error('Online payment checkout failed', err);
      setError(err.message || 'Unable to start online payment.');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition flex items-center gap-2 disabled:opacity-60"
      >
        <CreditCard size={16} /> {busy ? 'Opening secure checkout…' : `Pay $${balance.toFixed(2)} by card`}
      </button>
      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}
