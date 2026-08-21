'use client';

import { formatCountdown } from '@/lib/time';
import type { LiveJobStage } from '@/lib/types';

/**
 * The countdown for one stage. Reads `remainingSeconds`, which the ops
 * context recomputes every second from the stage's stored
 * expected-completion timestamp — nothing here accumulates, so a refresh
 * never shifts a timer.
 */
export function TimerDisplay({
  stage,
  cancelled = false,
  size = 'md',
  showProgress = false,
}: {
  stage: LiveJobStage | null;
  /** The parent job was cancelled — overrides whatever the stage says. */
  cancelled?: boolean;
  size?: 'md' | 'lg';
  showProgress?: boolean;
}) {
  if (cancelled || !stage) {
    return <div className={`timer timer-${size} timer-idle`}>-</div>;
  }

  if (stage.status === 'completed') {
    const delta = stage.performanceDelta;
    const tone = delta === null ? 'idle' : delta > 0 ? 'overdue' : 'normal';
    return (
      <div>
        <div className={`timer timer-${size} timer-${tone === 'normal' ? 'normal' : tone}`}>
          {stage.actualDuration ?? '-'} min
        </div>
        <div className="timer-note">
          {delta === null
            ? 'Completed'
            : delta === 0
              ? 'On target'
              : delta > 0
                ? `${delta} min over target`
                : `${Math.abs(delta)} min under target`}
        </div>
      </div>
    );
  }

  if (stage.status === 'waiting') {
    return (
      <div>
        <div className={`timer timer-${size} timer-idle`}>Not started</div>
        <div className="timer-note">Target {stage.expectedDuration} min</div>
      </div>
    );
  }

  if (stage.status === 'assigned') {
    return (
      <div>
        <div className={`timer timer-${size} timer-soon`}>Pending</div>
        <div className="timer-note">Waiting for acceptance</div>
      </div>
    );
  }

  const overdue = stage.remainingSeconds < 0;
  const soon = !overdue && stage.remainingSeconds <= 5 * 60;
  const tone = overdue ? 'overdue' : soon ? 'soon' : 'normal';
  const elapsedRatio =
    1 - Math.min(1, Math.max(0, stage.remainingSeconds / (stage.expectedDuration * 60)));

  return (
    <div>
      <div className={`timer timer-${size} timer-${tone}`}>
        {overdue ? '+' : ''}
        {formatCountdown(stage.remainingSeconds)}
      </div>
      <div className="timer-note">{overdue ? 'OVERDUE' : 'remaining'}</div>
      {showProgress && (
        <div className={`progress ${overdue ? 'over' : soon ? 'soon' : ''}`}>
          <span style={{ width: `${Math.round(elapsedRatio * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
