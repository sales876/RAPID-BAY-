-- ===========================================================================
-- Diagnostic only — temporary. staff_insert already has `with check (true)`
-- and the insert STILL gets rejected with the RLS violation message. This
-- fully disables RLS on notifications to prove whether RLS is really the
-- mechanism blocking it, or whether something else is producing a
-- confusingly identical error.
-- ===========================================================================
alter table notifications disable row level security;
