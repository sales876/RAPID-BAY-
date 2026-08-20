import { NextResponse } from 'next/server';
import { buildReportRow } from '@/lib/report-row';
import { readSheetsConfig, upsertJobRow } from '@/lib/sheets/client';
import { getAdminClient } from '@/lib/supabase/admin';
import { mapCarType, mapJob, mapJobStage } from '@/lib/supabase/mappers';
import type { Job } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mirrors a single job into Google Sheets.
 *
 * Called fire-and-forget after every job mutation. A failure here is reported
 * but never surfaced as an operator-facing error: the spreadsheet is a
 * reporting destination, and the floor must not stop when Google is slow.
 *
 * Body: `{ jobId }` to read the record from Supabase, or `{ job }` to push a
 * record supplied by the caller.
 */
export async function POST(request: Request) {
  const config = readSheetsConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: 'Google Sheets is not configured.' },
      { status: 200 },
    );
  }

  let body: { jobId?: string; job?: Job };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    let job: Job | null = body.job ?? null;
    let carTypes = [] as ReturnType<typeof mapCarType>[];

    if (!job && body.jobId) {
      const admin = getAdminClient();
      if (!admin) {
        return NextResponse.json(
          { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not set.' },
          { status: 500 },
        );
      }
      const [jobResult, stagesResult, carTypeResult] = await Promise.all([
        admin.from('jobs').select('*').eq('id', body.jobId).single(),
        admin.from('job_stages').select('*').eq('job_id', body.jobId).order('stage_order'),
        admin.from('car_types').select('*'),
      ]);
      if (jobResult.error) throw jobResult.error;
      if (stagesResult.error) throw stagesResult.error;
      job = mapJob(jobResult.data, (stagesResult.data ?? []).map(mapJobStage));
      carTypes = (carTypeResult.data ?? []).map(mapCarType);
    }

    if (!job) {
      return NextResponse.json({ ok: false, error: 'No job supplied.' }, { status: 400 });
    }

    const result = await upsertJobRow(config, buildReportRow(job, carTypes));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sheets sync failed.';
    console.error('[sheets/sync]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
