import { NextResponse } from 'next/server';
import { buildReportRow } from '@/lib/report-row';
import { readSheetsConfig, replaceAllRows } from '@/lib/sheets/client';
import { getAdminClient } from '@/lib/supabase/admin';
import { mapCarType, mapJob, mapJobStage } from '@/lib/supabase/mappers';
import type { Job } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rebuilds the Google Sheet from scratch.
 *
 * Used from Settings after connecting a spreadsheet, or to repair the mirror if
 * it drifts. Accepts `{ from, to }` date keys to limit the range, or `{ jobs }`
 * when the caller holds the records (demo mode).
 */
export async function POST(request: Request) {
  const config = readSheetsConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: 'Google Sheets is not configured. Set the GOOGLE_SHEETS_* variables.' },
      { status: 400 },
    );
  }

  let body: { from?: string; to?: string; jobs?: Job[] } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body means "everything".
  }

  try {
    let jobs: Job[] = body.jobs ?? [];
    let carTypes = [] as ReturnType<typeof mapCarType>[];

    if (!body.jobs) {
      const admin = getAdminClient();
      if (!admin) {
        return NextResponse.json(
          { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not set.' },
          { status: 500 },
        );
      }
      let query = admin.from('jobs').select('*').order('arrival_time', { ascending: true });
      if (body.from) query = query.gte('date', body.from);
      if (body.to) query = query.lte('date', body.to);

      const [jobResult, carTypeResult] = await Promise.all([query, admin.from('car_types').select('*')]);
      if (jobResult.error) throw jobResult.error;

      const jobIds = (jobResult.data ?? []).map((j) => j.id);
      const stagesByJob = new Map<string, any[]>();
      if (jobIds.length) {
        const { data: stageRows, error: stageError } = await admin
          .from('job_stages')
          .select('*')
          .in('job_id', jobIds)
          .order('stage_order');
        if (stageError) throw stageError;
        for (const row of stageRows ?? []) {
          const list = stagesByJob.get(row.job_id) ?? [];
          list.push(row);
          stagesByJob.set(row.job_id, list);
        }
      }

      jobs = (jobResult.data ?? []).map((row) =>
        mapJob(row, (stagesByJob.get(row.id) ?? []).map(mapJobStage)),
      );
      carTypes = (carTypeResult.data ?? []).map(mapCarType);
    }

    const written = await replaceAllRows(
      config,
      jobs.map((job) => buildReportRow(job, carTypes)),
    );
    return NextResponse.json({ ok: true, rows: written });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backfill failed.';
    console.error('[sheets/backfill]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
