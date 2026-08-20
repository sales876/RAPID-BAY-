import { NextResponse } from 'next/server';
import { readSheetsConfig } from '@/lib/sheets/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reports which integrations are wired up, without ever returning a secret.
 * The Settings screen uses this to show operators what is connected.
 */
export async function GET() {
  const sheets = readSheetsConfig();

  return NextResponse.json({
    supabase: {
      configured: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
      serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      url: process.env.NEXT_PUBLIC_SUPABASE_URL
        ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
        : null,
    },
    googleSheets: {
      configured: Boolean(sheets),
      tabName: sheets?.tabName ?? null,
      // Safe to show: it is the address the spreadsheet must be shared with.
      serviceAccount: sheets?.clientEmail ?? null,
      spreadsheetId: sheets ? `${sheets.spreadsheetId.slice(0, 6)}…` : null,
    },
  });
}
