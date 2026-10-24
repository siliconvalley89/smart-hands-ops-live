import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import useQuotes from '../hooks/useQuotes';
import { canAcceptQuote, isQuoteExpired, quoteTotal } from '../lib/quotes';

const acceptQuoteCall = httpsCallable(functions, 'acceptQuote');
const money = (amount) => `$${Number(amount || 0).toFixed(2)}`;
const formatDate = (timestamp) => (timestamp?.toDate ? timestamp.toDate().toLocaleDateString() : '—');

export default function ClientQuotes({ clientEmail }) {
  const quotes = useQuotes({ clientEmail });
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  if (quotes.length === 0) return null;

  const accept = async (quote) => {
    setBusyId(quote.id);
    setMessage('');
    try {
      await acceptQuoteCall({ quoteId: quote.id });
      setMessage('Quote accepted. Your job is now in your requests.');
    } catch (err) {
      console.error('Accept quote failed', err);
      setMessage(err.message || 'Unable to accept this quote.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="grid gap-4 rounded-3xl bg-slate-800 border border-slate-700 p-5">
      <h2 className="text-xl font-semibold text-white">Your quotes</h2>
      {message && <p className="text-sm text-slate-300">{message}</p>}
      <div className="grid gap-3">
        {quotes.map((quote) => {
          const expired = quote.status === 'Sent' && isQuoteExpired(quote);
          return (
            <article key={quote.id} className="grid gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 sm:flex sm:items-center sm:justify-between">
              <div className="grid gap-1">
                <p className="font-semibold text-white">{quote.task || 'Service quote'}</p>
                <p className="text-sm text-slate-400">
                  Total {money(quoteTotal(quote.lines, quote.serviceFee))} · Valid until {formatDate(quote.validUntil)}
                </p>
              </div>
              {canAcceptQuote(quote) && (
                <button
                  type="button"
                  disabled={busyId === quote.id}
                  onClick={() => accept(quote)}
                  className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition disabled:opacity-50"
                >
                  {busyId === quote.id ? 'Accepting…' : 'Accept quote'}
                </button>
              )}
              {quote.status === 'Sent' && expired && <span className="text-sm text-slate-400">Expired</span>}
              {quote.status === 'Accepted' && <span className="text-sm font-semibold text-teal-300">Accepted, job created</span>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
