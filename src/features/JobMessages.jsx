import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import useJobMessages from '../hooks/useJobMessages';
import { auth } from '../firebase';
import { toMillis } from '../lib/jobTime';
import { formatPacific } from '../lib/pacificTime';
import { canUseJobThread } from '../lib/messages';

const stamp = (value) => formatPacific(value, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function JobMessages({ job, profile, readAtMs }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const { messages, loadError, send, markRead } = useJobMessages(job.id, profile, open && canUseJobThread(profile.role));
  const lastMessageMs = toMillis(job.lastMessageAt);
  const listRef = useRef(null);

  useEffect(() => {
    if (open && lastMessageMs != null && (readAtMs == null || readAtMs < lastMessageMs)) {
      markRead().catch((error) => console.error('Unable to mark messages read', error));
    }
  }, [open, lastMessageMs, readAtMs, markRead]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  if (!canUseJobThread(profile.role)) return null;

  const handleSend = async (event) => {
    event.preventDefault();
    setSendError('');
    setSending(true);
    try {
      if (await send(draft)) setDraft('');
    } catch (error) {
      console.error('Unable to send job message', error);
      setSendError('Message not sent. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  const me = auth.currentUser?.email;

  return (
    <div className="rounded-3xl bg-slate-950/40 border border-slate-700 p-4">
      <button type="button" onClick={() => setOpen((prev) => !prev)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-sm text-slate-400 uppercase tracking-[0.18em]"><MessageSquare size={16} /> Messages</span>
        <span className="text-xs text-slate-400">{open ? 'Hide' : 'Open'}</span>
      </button>

      {open && (
        <div className="mt-4 grid gap-3">
          <div ref={listRef} className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {loadError && <div className="text-sm text-rose-300">{loadError}</div>}
            {!loadError && messages.length === 0 && <div className="text-sm text-slate-500">No messages yet.</div>}
            {messages.map((message) => {
              const mine = message.authorEmail === me;
              return (
                <div key={message.id} className={`rounded-2xl px-3 py-2 text-sm ${mine ? 'ml-8 bg-teal-900/40 text-teal-100' : 'mr-8 bg-slate-900 text-slate-200'}`}>
                  <div className="text-xs text-slate-400">
                    {message.authorName || message.authorEmail} · {message.createdAt ? stamp(toMillis(message.createdAt)) : 'Sending…'}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{message.text}</div>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleSend} className="flex gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Message the team about this job"
              className="flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition disabled:opacity-50"
            >
              Send
            </button>
          </form>
          {sendError && <div className="text-sm text-rose-300">{sendError}</div>}
        </div>
      )}
    </div>
  );
}
