'use client';

import { useMemo, useState } from 'react';
import { FlagBadge } from '@/components/StageIndicator';
import { useAuth } from '@/lib/auth';
import { myCompletedStages } from '@/lib/derive';
import { useOps } from '@/lib/ops-context';
import { formatClock, formatLongDate, shiftDateKey } from '@/lib/time';

/**
 * A worker's own completed work, most recent first. Nothing about anyone
 * else's stages, and no payment or customer-management actions — just proof
 * of what they did and how it measured up.
 */
export default function StaffHistoryPage() {
  const { session } = useAuth();
  const { jobs, today, snapshot } = useOps();
  const [dateKey, setDateKey] = useState(today);
  const [allTime, setAllTime] = useState(false);

  const workerId = session?.workerId ?? '';
  const carLabel = (id: string) => snapshot.carTypes.find((c) => c.id === id)?.label ?? id;

  const mine = useMemo(
    () => (workerId ? myCompletedStages(jobs, workerId, allTime ? undefined : dateKey) : []),
    [jobs, workerId, dateKey, allTime],
  );

  const todayCount = mine.length;

  return (
    <div>
      <div className="row gap-8 wrap" style={{ marginBottom: 14 }}>
        <button
          className="btn btn-sm"
          onClick={() => { setAllTime(false); setDateKey((d) => shiftDateKey(d, -1)); }}
          aria-label="Previous day"
          disabled={allTime}
        >
          ‹
        </button>
        <span className="small strong">{allTime ? 'All time' : formatLongDate(dateKey)}</span>
        <button
          className="btn btn-sm"
          onClick={() => { setAllTime(false); setDateKey((d) => shiftDateKey(d, 1)); }}
          aria-label="Next day"
          disabled={allTime}
        >
          ›
        </button>
        <div className="spacer" />
        <button className="btn btn-sm" aria-pressed={allTime} onClick={() => setAllTime((v) => !v)}>
          {allTime ? 'All time ✓' : 'All time'}
        </button>
      </div>

      <div className="tiny muted" style={{ marginBottom: 10 }}>
        {todayCount} stage{todayCount === 1 ? '' : 's'} completed
      </div>

      {mine.length === 0 && (
        <div className="empty" style={{ paddingTop: 30 }}>No completed work in this range.</div>
      )}

      {mine.map(({ job, stage }) => (
        <article key={stage.id} className="stage-card is-completed">
          <div className="row gap-8">
            <span className="plate">{job.plateNumber}</span>
            <div className="spacer" />
            {stage.flagged && <FlagBadge reason={stage.flagReason} />}
          </div>
          <div>
            <div className="strong">{job.customerName}</div>
            <div className="small muted">{carLabel(job.carType)} · {stage.name}</div>
          </div>
          <div className="row gap-12">
            <div className="timer timer-md timer-normal">{stage.actualDuration} min</div>
            <div className="spacer" />
            <div className="tiny muted right">
              <div>Target {stage.expectedDuration} min</div>
              <div>Done {formatClock(stage.completionTime)}</div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
