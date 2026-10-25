import { useRef, useState } from 'react';
import TechNameWithPhoto from './TechNameWithPhoto';
import {
  BOARD_END_MINUTE,
  BOARD_START_MINUTE,
  findTechConflict,
  getDayPlacement,
  getJobWindow,
  getWeekDays,
  isJobAssigned,
  isJobMovable,
  minuteOfDayToMs,
  snapMinute,
} from '../lib/jobTime';

const PX_PER_MINUTE = 1;
const GRID_HEIGHT = (BOARD_END_MINUTE - BOARD_START_MINUTE) * PX_PER_MINUTE;
const HOUR_LINES = `repeating-linear-gradient(to bottom, transparent 0, transparent ${60 * PX_PER_MINUTE - 1}px, rgba(148,163,184,0.15) ${60 * PX_PER_MINUTE}px)`;
const UNASSIGNED = '__unassigned__';
const MIN_BLOCK_PX = 24;

const timeLabel = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (day) => day.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
const pad = (value) => String(value).padStart(2, '0');

export default function SchedulingBoard({ activeJobs, techs, onMoveJob }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [showGrid, setShowGrid] = useState(true);
  const [moveDraft, setMoveDraft] = useState(null);
  const [moveError, setMoveError] = useState('');
  const dragRef = useRef(null);
  const days = getWeekDays(anchor);
  const todayString = new Date().toDateString();

  const techRows = (techs || [])
    .filter((tech) => tech.email)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map((tech) => ({ key: tech.email, tech }));
  const techKeys = new Set(techRows.map((row) => row.key));
  const rowKeyOf = (job) => (techKeys.has(job.assignedTechEmail) ? job.assignedTechEmail : UNASSIGNED);

  const scheduled = activeJobs
    .filter((job) => job.status !== 'Completed')
    .map((job) => ({ job, win: getJobWindow(job), rowKey: rowKeyOf(job) }))
    .filter((item) => item.win)
    .map((item) => ({
      ...item,
      conflicted: Boolean(findTechConflict(item.job, item.job.assignedTechEmail, activeJobs)),
    }));
  const tray = activeJobs.filter((job) => isJobAssigned(job) && !getJobWindow(job));

  const rows = scheduled.some((item) => item.rowKey === UNASSIGNED)
    ? [...techRows, { key: UNASSIGNED, tech: null }]
    : techRows;

  const shiftWeeks = (weeks) => setAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + weeks * 7));

  const startDrag = (e, job) => {
    dragRef.current = { jobId: job.id, offsetY: e.clientY - e.currentTarget.getBoundingClientRect().top };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', job.id);
  };

  const handleDrop = (e, rowKey, day) => {
    e.preventDefault();
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const job = activeJobs.find((item) => item.id === drag.jobId);
    if (!job) return;
    const cellTop = e.currentTarget.getBoundingClientRect().top;
    const minute = snapMinute(BOARD_START_MINUTE + (e.clientY - cellTop - drag.offsetY) / PX_PER_MINUTE);
    const clamped = Math.min(Math.max(minute, BOARD_START_MINUTE), BOARD_END_MINUTE - 30);
    onMoveJob(job, { techEmail: rowKey, startMs: minuteOfDayToMs(day, clamped) });
  };

  const openMove = (job) => {
    const win = getJobWindow(job);
    const start = win ? new Date(win.start) : null;
    const dayIndex = start ? days.findIndex((day) => day.toDateString() === start.toDateString()) : -1;
    setMoveDraft({
      job,
      techEmail: job.assignedTechEmail || techRows[0]?.key || '',
      dayIndex: dayIndex >= 0 ? dayIndex : 0,
      time: start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '08:00',
    });
    setMoveError('');
  };

  const closeMove = () => {
    setMoveDraft(null);
    setMoveError('');
  };

  const submitMove = (e) => {
    e.preventDefault();
    const [hours, minutes] = moveDraft.time.split(':').map(Number);
    const minute = hours * 60 + minutes;
    if (!Number.isFinite(minute) || minute < BOARD_START_MINUTE || minute > BOARD_END_MINUTE - 30) {
      setMoveError('Choose a start time between 6:00 AM and 9:30 PM.');
      return;
    }
    if (!moveDraft.techEmail) {
      setMoveError('Choose a tech.');
      return;
    }
    onMoveJob(moveDraft.job, { techEmail: moveDraft.techEmail, startMs: minuteOfDayToMs(days[moveDraft.dayIndex], minute) });
    closeMove();
  };

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Schedule</h2>
          <p className="text-slate-400 text-sm mt-1">Drag an open job, or tap it and choose Move, to change its time, its tech, or both.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button type="button" onClick={() => shiftWeeks(-1)} className="rounded-2xl border border-slate-600 px-3 py-2 text-slate-200 hover:bg-slate-700 transition">Prev</button>
          <button type="button" onClick={() => setAnchor(new Date())} className="rounded-2xl border border-slate-600 px-3 py-2 text-slate-200 hover:bg-slate-700 transition">Today</button>
          <button type="button" onClick={() => shiftWeeks(1)} className="rounded-2xl border border-slate-600 px-3 py-2 text-slate-200 hover:bg-slate-700 transition">Next</button>
          <button type="button" onClick={() => setShowGrid((prev) => !prev)} className="rounded-2xl border border-slate-600 px-3 py-2 text-slate-200 hover:bg-slate-700 transition">{showGrid ? 'Collapse' : 'Expand'}</button>
          <span className="ml-2 text-slate-300 whitespace-nowrap">
            {days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
      </div>

      {moveDraft && (
        <form onSubmit={submitMove} className="grid gap-3 rounded-3xl border border-teal-700 bg-slate-900 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_200px_160px_140px_auto] xl:items-end">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Moving</div>
            <div className="font-semibold text-white truncate">{moveDraft.job.client || 'Job'}{moveDraft.job.task ? ` · ${moveDraft.job.task}` : ''}</div>
          </div>
          <label className="grid gap-1 text-xs text-slate-400">
            Tech
            <select
              value={moveDraft.techEmail}
              onChange={(e) => setMoveDraft((prev) => ({ ...prev, techEmail: e.target.value }))}
              className="rounded-2xl bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
            >
              {techRows.map((row) => <option key={row.key} value={row.key}>{row.tech.name || row.key}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-400">
            Day
            <select
              value={moveDraft.dayIndex}
              onChange={(e) => setMoveDraft((prev) => ({ ...prev, dayIndex: Number(e.target.value) }))}
              className="rounded-2xl bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
            >
              {days.map((day, index) => <option key={day.getTime()} value={index}>{dayLabel(day)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-400">
            Start
            <input
              type="time"
              value={moveDraft.time}
              onChange={(e) => setMoveDraft((prev) => ({ ...prev, time: e.target.value }))}
              className="rounded-2xl bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition">Move job</button>
            <button type="button" onClick={closeMove} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">Cancel</button>
          </div>
          {moveError && <p className="text-sm text-red-300 sm:col-span-2 xl:col-span-5">{moveError}</p>}
        </form>
      )}

      <div className={`grid gap-4 ${showGrid ? 'xl:grid-cols-[minmax(0,1fr)_260px]' : ''}`}>
        {showGrid && (
        <div className="overflow-x-auto rounded-3xl border border-slate-700 bg-slate-900/70">
          <div style={{ minWidth: 140 + 7 * 130 }}>
            <div className="grid text-xs text-slate-400" style={{ gridTemplateColumns: '140px repeat(7, minmax(130px, 1fr))' }}>
              <div className="p-2" />
              {days.map((day) => (
                <div key={day.getTime()} className={`p-2 border-l border-slate-700 text-center ${day.toDateString() === todayString ? 'text-teal-300 font-semibold' : ''}`}>
                  {dayLabel(day)}
                </div>
              ))}
            </div>

            {rows.map((row) => (
              <div key={row.key} className="grid border-t border-slate-700" style={{ gridTemplateColumns: '140px repeat(7, minmax(130px, 1fr))' }}>
                <div className="sticky left-0 z-10 bg-slate-900 p-2 flex items-start">
                  {row.tech
                    ? <TechNameWithPhoto job={{ assignedTechEmail: row.tech.email, assignedTechName: row.tech.name }} techs={techs} />
                    : <span className="text-sm text-slate-400">Unassigned</span>}
                </div>
                {days.map((day) => (
                  <div
                    key={day.getTime()}
                    onDragOver={(e) => { if (row.key !== UNASSIGNED) e.preventDefault(); }}
                    onDrop={(e) => { if (row.key !== UNASSIGNED) handleDrop(e, row.key, day); }}
                    className="relative border-l border-slate-700"
                    style={{ height: GRID_HEIGHT, backgroundImage: HOUR_LINES }}
                  >
                    {scheduled
                      .filter((item) => item.rowKey === row.key)
                      .map((item) => ({ ...item, place: getDayPlacement(item.win, day) }))
                      .filter((item) => item.place)
                      .map(({ job, win, place, conflicted }) => {
                        const movable = isJobMovable(job);
                        return (
                          <div
                            key={`${job.id}-${day.getTime()}`}
                            draggable={movable}
                            onDragStart={movable ? (e) => startDrag(e, job) : undefined}
                            onClick={movable ? () => openMove(job) : undefined}
                            onKeyDown={movable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMove(job); } } : undefined}
                            role={movable ? 'button' : undefined}
                            tabIndex={movable ? 0 : undefined}
                            title={movable ? 'Drag to reschedule, or click to move' : `${job.status} jobs cannot be moved`}
                            className={`absolute left-1 right-1 overflow-hidden rounded-xl border px-2 py-1 text-xs ${movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-75'} ${conflicted ? 'border-red-500 bg-red-950/60' : 'border-teal-600 bg-teal-950/60'}`}
                            style={{ top: place.top, height: Math.max(place.height, MIN_BLOCK_PX) }}
                          >
                            <div className="font-semibold text-white truncate">{job.client || 'Job'}</div>
                            <div className="text-slate-300 truncate">{job.task}</div>
                            <div className="text-slate-400 truncate">{timeLabel(win.start)}–{timeLabel(win.end)}</div>
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        )}

        <aside className="rounded-3xl border border-slate-700 bg-slate-900/70 p-4">
          <h3 className="text-sm font-semibold text-white">Unscheduled assigned jobs</h3>
          <p className="text-xs text-slate-400 mt-1 mb-3">Drag a job onto a tech's day, or choose Move, to set its time.</p>
          {tray.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing waiting.</p>
          ) : (
            <div className="grid gap-2">
              {tray.map((job) => {
                const movable = isJobMovable(job);
                return (
                  <div
                    key={job.id}
                    draggable={movable}
                    onDragStart={movable ? (e) => startDrag(e, job) : undefined}
                    className={`rounded-2xl border border-slate-600 bg-slate-800 p-3 text-xs ${movable ? 'cursor-grab active:cursor-grabbing' : 'opacity-75'}`}
                  >
                    <div className="font-semibold text-white truncate">{job.client || 'Job'}</div>
                    <div className="text-slate-300 truncate">{job.task}</div>
                    <div className="text-slate-400 truncate">{job.assignedTechName}</div>
                    <button
                      type="button"
                      disabled={!movable}
                      onClick={() => openMove(job)}
                      className="mt-2 rounded-xl border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700 transition disabled:opacity-50"
                    >
                      Move
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
