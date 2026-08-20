-- ===========================================================================
-- JRHQ Car Wash — Migration 002c: fix job registration failure
--
-- Bug: migration_002b's rewritten create_job() inserts into `jobs` but never
-- sets `expected_duration` — that column moved to per-stage tracking in
-- `job_stages.expected_duration` and is no longer read anywhere in the app
-- (see src/lib/supabase/mappers.ts mapJob, which never touches it). But the
-- original schema.sql still has `jobs.expected_duration int not null`, so
-- every create_job() call has been failing with:
--   23502 null value in column "expected_duration" of relation "jobs"
--   violates not-null constraint
-- and the app was swallowing/masking it — new vehicles never actually saved.
--
-- Fix: drop the now-unused NOT NULL constraint. Run this on its own.
-- ===========================================================================

alter table jobs alter column expected_duration drop not null;
