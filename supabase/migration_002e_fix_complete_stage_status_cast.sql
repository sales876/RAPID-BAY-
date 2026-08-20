-- ===========================================================================
-- JRHQ Car Wash — Migration 002e: fix complete_stage() status type mismatch
--
-- Same bug class as 002d, found in a different function: complete_stage()
-- rolls the parent job to 'completed' or 'in_progress' via a bare
-- `case when v_all_done then 'completed' else 'in_progress' end`, which
-- Postgres resolves to `text`, not the `job_status` enum. Every attempt to
-- complete a stage failed with:
--   42804 column "status" is of type job_status but expression is of type text
--
-- This migration was written after a full audit of every SQL function in
-- migration_002b for the same missing-cast pattern (grep for `case when.*
-- then '` feeding an enum column) — this was the only remaining instance.
-- create_job's two instances were already fixed in migration_002d.
--
-- Run this on its own.
-- ===========================================================================

create or replace function complete_stage(
  p_job_id uuid,
  p_stage_order int,
  p_completed_by uuid,
  p_photo_url text default null
) returns job_stages as $fn$
declare
  v_stage job_stages%rowtype;
  v_now timestamptz := now();
  v_actual int;
  v_all_done boolean;
begin
  select * into v_stage from job_stages where job_id = p_job_id and stage_order = p_stage_order;
  if v_stage.id is null then
    raise exception 'Unknown stage % for job %', p_stage_order, p_job_id;
  end if;

  v_actual := greatest(1, round(extract(epoch from (v_now - coalesce(v_stage.start_time, v_now))) / 60)::int);

  update job_stages set
    completion_time = v_now,
    actual_duration = v_actual,
    status = 'completed',
    completed_by = p_completed_by,
    photo_url = p_photo_url,
    flagged = v_actual < expected_duration * 0.5,
    flag_reason = case when v_actual < expected_duration * 0.5
      then format('Completed in %s min against a %s min target — under 50%% of target.', v_actual, expected_duration)
      else null
    end
  where job_id = p_job_id and stage_order = p_stage_order
  returning * into v_stage;

  select bool_and(status = 'completed') into v_all_done from job_stages where job_id = p_job_id;

  update jobs set status = case when v_all_done then 'completed'::job_status else 'in_progress'::job_status end
   where id = p_job_id;

  return v_stage;
end $fn$ language plpgsql volatile;
