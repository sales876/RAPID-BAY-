-- Cleanup: drop the temporary diagnostic functions used while tracking down
-- the notifications RLS issue (migration_003d). Not needed going forward —
-- the real fix lives in migration_003e (create_notification).
drop function if exists debug_list_policies(text);
drop function if exists debug_session_info();
