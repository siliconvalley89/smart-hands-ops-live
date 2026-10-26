import { useEffect, useState } from 'react';
import { CheckCircle, X, XCircle } from 'lucide-react';

const RETURNS = new Map([
  ['success', {
    tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
    Icon: CheckCircle,
    text: 'Payment received, thank you. Your balance updates once Stripe confirms the payment, usually within a minute. Bank transfers can take several business days to clear.',
  }],
  ['cancelled', {
    tone: 'border-slate-600 bg-slate-800 text-slate-200',
    Icon: XCircle,
    text: 'Payment cancelled. Your balance has not changed.',
  }],
]);

export default function PaymentReturnBanner() {
  const [status] = useState(() => new URLSearchParams(window.location.search).get('payment'));
  const [visible, setVisible] = useState(true);
  const result = RETURNS.get(status);

  useEffect(() => {
    if (!result) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('payment');
    window.history.replaceState(window.history.state, '', url);
  }, [result]);

  if (!result || !visible) return null;
  const { tone, Icon, text } = result;

  return (
    <div role="status" className={`mb-4 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${tone}`}>
      <div className="flex items-start gap-2">
        <Icon size={18} className="mt-0.5 shrink-0" />
        <span>{text}</span>
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => setVisible(false)} className="shrink-0 rounded-lg p-1 hover:bg-white/10 transition">
        <X size={16} />
      </button>
    </div>
  );
}
