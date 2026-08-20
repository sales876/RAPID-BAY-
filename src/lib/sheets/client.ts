import { google } from 'googleapis';
import { REPORT_COLUMNS, type ReportRow } from '../report-row';

/**
 * Google Sheets mirror.
 *
 * Supabase stays the system of record; the spreadsheet is the operational copy
 * the business already lives in. Credentials come from the environment — a
 * service account with edit access to the target spreadsheet — so nothing is
 * baked into the build.
 */

export interface SheetsConfig {
  spreadsheetId: string;
  tabName: string;
  clientEmail: string;
  privateKey: string;
}

export function readSheetsConfig(): SheetsConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!spreadsheetId || !clientEmail || !privateKey) return null;

  return {
    spreadsheetId,
    tabName: process.env.GOOGLE_SHEETS_TAB_NAME || 'Jobs',
    clientEmail,
    // Environment files usually carry the key with escaped newlines.
    privateKey: privateKey.replace(/\\n/g, '\n'),
  };
}

function sheetsClient(config: SheetsConfig) {
  const auth = new google.auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** Creates the tab if it is missing and makes sure row 1 holds the headers. */
async function ensureSheet(config: SheetsConfig) {
  const sheets = sheetsClient(config);

  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === config.tabName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: config.tabName } } }],
      },
    });
  }

  const header = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.tabName}!A1:Z1`,
  });

  if (!header.data.values?.[0]?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${config.tabName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[...REPORT_COLUMNS]] },
    });
  }

  return sheets;
}

/**
 * Writes a job's row, replacing the existing line for that job if there is one.
 * Job ID lives in column A, which is what makes the sync idempotent — a job
 * that is registered, paid, then completed occupies one row, not three.
 */
export async function upsertJobRow(config: SheetsConfig, row: ReportRow): Promise<'updated' | 'appended'> {
  const sheets = await ensureSheet(config);
  const jobId = String(row[0]);

  const idColumn = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.tabName}!A:A`,
  });

  const ids = (idColumn.data.values ?? []).map((r) => r[0]);
  const existingIndex = ids.findIndex((id) => id === jobId);

  if (existingIndex > 0) {
    const rowNumber = existingIndex + 1; // values API rows are 1-based
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${config.tabName}!A${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
    return 'updated';
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  return 'appended';
}

/** Bulk replace — used by the backfill route to rebuild the sheet. */
export async function replaceAllRows(config: SheetsConfig, rows: ReportRow[]): Promise<number> {
  const sheets = await ensureSheet(config);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: config.spreadsheetId,
    range: `${config.tabName}!A2:Z`,
  });

  if (rows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${config.tabName}!A2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  }
  return rows.length;
}
