-- ===========================================================================
-- JRHQ Car Wash — Migration 002a: add the "worker" role
--
-- RUN THIS FILE ON ITS OWN, AS ITS OWN QUERY EXECUTION — do not paste it
-- together with migration_002b in the same run.
--
-- Postgres will not let a newly-added enum value be *used* in the same
-- transaction that creates it ("unsafe use of new value"), and the Supabase
-- SQL editor runs every statement you paste as one transaction. Splitting
-- this into its own execution lets it commit before migration_002b (which
-- references 'worker' in a policy) runs.
-- ===========================================================================

alter type app_role add value if not exists 'worker';
