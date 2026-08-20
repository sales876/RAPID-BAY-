-- ===========================================================================
-- JRHQ Car Wash — Migration 003c: fix missing notifications INSERT policy
--
-- Bug: assigning a stage (create_job / assign_stage / reassign_stage) never
-- created a notification — the insert was silently rejected by RLS:
--   42501 new row violates row-level security policy for table "notifications"
-- despite is_staff() = true and is_worker() = false for the calling admin.
-- The staff_insert policy from migration_003b evidently didn't take effect
-- (verified: is_staff()/is_worker() both return correct values via RPC, so
-- the policy predicate itself is fine — the policy just isn't there to match
-- against). Re-creating it here is idempotent and safe to run even if it
-- already exists.
--
-- Run this on its own.
-- ===========================================================================

drop policy if exists staff_insert on notifications;
create policy staff_insert on notifications for insert with check (
  is_staff() and not is_worker()
);

-- Sanity check other notifications policies exist too, in case the same
-- silent-failure affected them.
drop policy if exists worker_read_own on notifications;
create policy worker_read_own on notifications for select using (
  audience = 'worker' and is_worker() and my_worker_id() = worker_id
);

drop policy if exists worker_mark_own_read on notifications;
create policy worker_mark_own_read on notifications for update using (
  audience = 'worker' and is_worker() and my_worker_id() = worker_id
) with check (
  audience = 'worker' and is_worker() and my_worker_id() = worker_id
);

drop policy if exists staff_read on notifications;
create policy staff_read on notifications for select using (
  audience = 'staff' and is_staff() and not is_worker()
);

drop policy if exists staff_mark_read on notifications;
create policy staff_mark_read on notifications for update using (
  audience = 'staff' and is_staff() and not is_worker()
) with check (
  audience = 'staff' and is_staff() and not is_worker()
);
