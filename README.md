# JRHQ — Car Wash Operations & Time Management System

A live operations floor for a car wash. It answers one question on every screen:

> **Where is every car, who is working on it, and when will it be ready?**

Vehicle arrives → reception registers it → a worker is assigned → the cleaning
timer starts → the job is completed → the worker becomes available again.

---

## Running it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. It starts in **demo mode** with a fully staged
floor — active vehicles, one overdue job, two workers about to free up, and two
weeks of history — so the whole workflow is visible immediately.

Demo sign-in (shown on the login screen):

| Account | Email | Password | Role |
| --- | --- | --- | --- |
| Operations Manager | `manager@jrhq.app` | `jrhq2026` | Admin |
| Front Desk | `reception@jrhq.app` | `jrhq2026` | Receptionist |

---

## Two modes

The application resolves its data layer once at startup:

**Demo mode** (no Supabase environment variables) — records live in the browser
and are broadcast between tabs, so two windows behave like two terminals on the
same counter. Timers, reports and Excel export all work. This is the mode to
demonstrate from.

**Live mode** (Supabase configured) — Supabase becomes the system of record,
realtime pushes changes to every connected screen, and every job is mirrored
into Google Sheets.

Screens never branch on which mode is active; both implement the same
`Repository` interface in `src/lib/repo/`.

### Going live

1. Create a Supabase project.
2. Run `supabase/schema.sql`, then `supabase/seed.sql`, in the SQL editor.
3. Copy `.env.example` to `.env.local` and fill in the Supabase values.
4. Create staff users in the Supabase Auth dashboard and insert matching rows
   into `profiles` (the SQL at the bottom of `seed.sql` shows how).

### Google Sheets

Create a Google Cloud service account with the Sheets API enabled, share the
target spreadsheet with the service account address as an **Editor**, and set
`GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_CLIENT_EMAIL` and
`GOOGLE_SHEETS_PRIVATE_KEY`.

Every job create and update is then mirrored automatically. The sync is keyed by
Job ID, so a vehicle that is registered, paid for, then completed occupies **one
row that updates** — not three appended rows. Settings → *Rebuild sheet now*
replays everything if the mirror ever drifts.

Sheets sync is fire-and-forget: if Google is slow or misconfigured, the floor
keeps running and the failure is logged, never shown as an operator error.

---

## How the timers work

No countdown is ever stored or accumulated. Each job holds `start_time` and
`expected_completion_time`; one clock in `OpsProvider` ticks each second, and
every countdown, status pill and availability bucket is recomputed from those
timestamps.

That is why a refresh, a reconnect, or a second terminal all show exactly the
same number — and why an overdue job is detected even if nobody had the page
open when it slipped.

| State | Condition | Shown as |
| --- | --- | --- |
| In Progress | more than 5 minutes left | `18:42 remaining` |
| Finishing Soon | 5 minutes or less | `04:21 remaining`, amber |
| Overdue | past expected completion | `+06:32 overdue`, red |

The 5-minute threshold is `NEXT_PUBLIC_FINISHING_SOON_MINUTES`.

---

## Duration is configuration, not code

Target time comes from **car type + service**, resolved in one place
(`resolveDuration`):

1. An explicit override in `service_durations` — e.g. SUV + Premium Wash = 40 min.
2. Otherwise the service's base duration × the car type's size factor.

Both are editable from **Services → Duration matrix**, where inherited values
are greyed and overrides are highlighted. Clearing a cell returns it to
inheriting.

---

## Screens

| Screen | What it is for |
| --- | --- |
| **Dashboard** | Today's numbers, worker availability buckets, the live queue |
| **Vehicles** | Every record, searchable by plate, customer, phone or worker |
| **Workers** | Worker board and performance against target |
| **Reports** | Today / yesterday / week / month / custom range, with export |
| **Services** | Services, car types and the duration matrix (admin) |
| **Settings** | Business config, integration status, export, roles (admin) |

Mobile is not the desktop layout shrunk: the queue becomes purpose-built cards,
navigation moves to a bottom bar, and registering a vehicle sits on a floating
action button.

---

## Roles

| Capability | Admin / Manager | Receptionist |
| --- | --- | --- |
| Register vehicles, assign workers | ✓ | ✓ |
| Complete jobs, update payment | ✓ | ✓ |
| Live queue and worker availability | ✓ | ✓ |
| Reports and Excel export | ✓ | ✓ |
| Manage services, durations, car types | ✓ | — |
| Manage the worker roster | ✓ | — |
| Settings and integrations | ✓ | — |

Permissions are asked for by name (`can('manage_services')`), not by comparing
role strings, so worker logins and per-branch scoping can be added without
touching the screens. Row level security in `schema.sql` enforces the same split
at the database.

---

## Project layout

```
src/
  app/
    (app)/            Dashboard, vehicles, workers, reports, services, settings
    api/              Google Sheets sync + backfill, integration status
    login/
    globals.css       The whole design system
  components/         Queue table, worker cards, timers, registration modal
  lib/
    config.ts         Business config, reference data, duration resolution
    derive.ts         Every clock-derived value: statuses, buckets, statistics
    ops-context.tsx   One snapshot, one clock, all actions
    repo/             Repository interface + local (demo) and Supabase impls
    export/excel.ts   Three-sheet workbook
    sheets/           Google Sheets mirror
    report-row.ts     One row definition shared by Excel and Sheets
supabase/
  schema.sql          Tables, functions, RLS, realtime
  seed.sql            Reference data and the 10 workers
```

---

## Built to extend

`branch_id` is on every operational table, permissions are named rather than
role-compared, and reference data is in the database rather than the UI. Adding
a second location, worker accounts, customer notifications or a payment provider
is additive work, not a rewrite. None of it is built yet — deliberately.

---

## Stack

Next.js 14 (App Router) · React 18 · TypeScript · Supabase (Postgres, Auth,
Realtime) · Google Sheets API · SheetJS · deployable to Vercel.
