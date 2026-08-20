-- ===========================================================================
-- JRHQ Car Wash — Migration 003a: add the "assigned" stage status
--
-- RUN THIS FILE ON ITS OWN, AS ITS OWN QUERY EXECUTION — same rule as
-- migration_002a: Postgres won't let a brand-new enum value be referenced in
-- the same transaction that creates it. Run migration_003b after this one.
--
-- New lifecycle: waiting -> assigned -> in_progress -> completed.
-- A stage sits in "assigned" the moment reception picks a worker, until that
-- worker taps Accept on their phone — that's what actually starts the clock.
-- ===========================================================================

alter type stage_status add value if not exists 'assigned';
