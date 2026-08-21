import * as XLSX from 'xlsx';
import { BUSINESS } from '../config';
import { buildPeriodReport, buildWorkerPerformance, toLiveJobs, toLiveWorkers } from '../derive';
import { REPORT_COLUMNS, buildReportRow } from '../report-row';
import { formatLongDate } from '../time';
import type { CarType, Job, Worker } from '../types';

/**
 * Excel export.
 *
 * Three sheets, in the order a manager reads them: the headline numbers, the
 * per-worker breakdown, then every job record behind them. Column widths and
 * number formats are set so the file is printable as-is.
 */

interface ExportOptions {
  jobs: Job[];
  workers: Worker[];
  carTypes: CarType[];
  /** Human label for the period, e.g. "Today — Tue 18 Aug 2026". */
  periodLabel: string;
  fileName?: string;
}

function autoWidth(rows: (string | number)[][]): XLSX.ColInfo[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      const len = String(cell ?? '').length;
      widths[i] = Math.min(38, Math.max(widths[i] ?? 10, len + 2));
    });
  }
  return widths.map((wch) => ({ wch }));
}

export function exportToExcel({
  jobs,
  workers,
  carTypes,
  periodLabel,
  fileName,
}: ExportOptions): void {
  const now = Date.now();
  const liveJobs = toLiveJobs(jobs, now);
  const liveWorkers = toLiveWorkers(workers, liveJobs, now);
  const summary = buildPeriodReport(liveJobs);
  const performance = buildWorkerPerformance(liveWorkers, liveJobs, '');

  const workbook = XLSX.utils.book_new();
  const round1 = (n: number | null) => (n === null ? '-' : Math.round(n * 10) / 10);

  // --- Sheet 1: Summary ----------------------------------------------------
  const summaryRows: (string | number)[][] = [
    [`${BUSINESS.name} · Operations Report`],
    [BUSINESS.branch],
    [periodLabel],
    [`Generated ${new Date().toLocaleString('en-GB')}`],
    [],
    ['Metric', 'Value'],
    ['Total vehicles', summary.totalVehicles],
    ['Completed', summary.completed],
    ['Currently active', summary.active],
    ['Cancelled', summary.cancelled],
    ['Jobs over target', summary.overdue],
    ['Flagged for review', summary.flagged],
    [],
    ['Average expected time (min)', round1(summary.avgExpected)],
    ['Average actual time (min)', round1(summary.avgActual)],
    ['Average difference (min)', round1(summary.avgDifference)],
    [],
    [`Revenue collected (${BUSINESS.currency})`, summary.revenueCollected],
    [`Revenue outstanding (${BUSINESS.currency})`, summary.revenueOutstanding],
    ['Paid jobs', summary.paid],
    ['Partially paid jobs', summary.partial],
    ['Unpaid jobs', summary.unpaid],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 34 }, { wch: 22 }];
  summarySheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
  ];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // --- Sheet 2: Worker performance ----------------------------------------
  const perfRows: (string | number)[][] = [
    [
      'Worker', 'Jobs completed', 'Active now', 'Avg target (min)',
      'Avg actual (min)', 'Avg difference (min)', 'On-time %',
      `Revenue collected (${BUSINESS.currency})`,
    ],
    ...performance.map((p) => [
      p.name,
      p.completed,
      p.activeJobs,
      round1(p.avgTarget),
      round1(p.avgActual),
      round1(p.avgDifference),
      p.onTimeRate === null ? '-' : Math.round(p.onTimeRate * 100),
      p.revenue,
    ]),
  ];
  const perfSheet = XLSX.utils.aoa_to_sheet(perfRows);
  perfSheet['!cols'] = autoWidth(perfRows);
  XLSX.utils.book_append_sheet(workbook, perfSheet, 'Worker Performance');

  // --- Sheet 3: Job records ------------------------------------------------
  const recordRows: (string | number)[][] = [
    [...REPORT_COLUMNS],
    ...jobs
      .slice()
      .sort((a, b) => (a.arrivalTime < b.arrivalTime ? 1 : -1))
      .map((job) => buildReportRow(job, carTypes)),
  ];
  const recordSheet = XLSX.utils.aoa_to_sheet(recordRows);
  recordSheet['!cols'] = autoWidth(recordRows);
  recordSheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: recordRows.length - 1, c: REPORT_COLUMNS.length - 1 },
    }),
  };
  XLSX.utils.book_append_sheet(workbook, recordSheet, 'Job Records');

  const safePeriod = periodLabel.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  XLSX.writeFile(workbook, fileName || `JRHQ-carwash-${safePeriod || 'report'}.xlsx`);
}

export function periodLabelForDate(dateKey: string): string {
  return formatLongDate(dateKey);
}
