import { BUSINESS } from './config';
import { STATUS_LABEL, toLiveJob } from './derive';
import { formatClock } from './time';
import type { CarType, Job } from './types';

/**
 * One row definition shared by the Excel export and the Google Sheets mirror,
 * so a printed report and the spreadsheet can never disagree about a column.
 *
 * `Job ID` leads the row: the Sheets sync uses it to update the existing line
 * for a job rather than appending a duplicate every time payment changes.
 * Stage columns are flattened to "Stage 1" / "Stage 2" so a two-leg job
 * (wash then detail) still fits one spreadsheet row.
 */
export const REPORT_COLUMNS = [
  'Job ID',
  'Date',
  'Arrival Time',
  'Customer Name',
  'Phone',
  'Plate Number',
  'Car Type',
  'Service',
  'Stage 1 Worker(s)',
  'Stage 2 Worker(s)',
  'Payment Status',
  'Amount',
  'Expected Duration (min)',
  'First Start',
  'Final Completion',
  'Actual Duration (min)',
  'Time Difference (min)',
  'Flagged',
  'Handover Confirmed',
  'Status',
] as const;

const PAYMENT_LABEL: Record<string, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  partial: 'Partial',
};

export type ReportRow = (string | number)[];

export function buildReportRow(job: Job, carTypes: CarType[] = []): ReportRow {
  const live = toLiveJob(job, Date.now());
  const carTypeLabel = carTypes.find((c) => c.id === job.carType)?.label ?? job.carType;
  const stages = [...job.stages].sort((a, b) => a.stageOrder - b.stageOrder);
  const stage1 = stages[0];
  const stage2 = stages[1];

  const difference =
    live.totalActualDuration !== null ? live.totalActualDuration - live.totalExpectedDuration : '';

  return [
    job.id,
    job.date,
    formatClock(job.arrivalTime),
    job.customerName,
    job.phone,
    job.plateNumber,
    carTypeLabel,
    job.serviceName,
    stage1?.workerNames.join(' + ') || 'Unassigned',
    stage2?.workerNames.join(' + ') || '',
    PAYMENT_LABEL[job.paymentStatus] ?? job.paymentStatus,
    Number(job.price ?? 0),
    live.totalExpectedDuration,
    formatClock(stage1?.startTime ?? null),
    formatClock(stages.at(-1)?.completionTime ?? null),
    live.totalActualDuration ?? '',
    difference === '' ? '' : (difference as number),
    live.hasFlag ? 'Yes' : '',
    job.handoverConfirmed ? 'Yes' : '',
    STATUS_LABEL[live.displayStatus],
  ];
}

export const CURRENCY = BUSINESS.currency;
