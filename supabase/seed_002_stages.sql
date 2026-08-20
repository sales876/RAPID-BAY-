-- ===========================================================================
-- JRHQ Car Wash — seed data for migration 002 (service stages)
-- Run after migration_002_stages_and_workers.sql.
--
-- Configures the Sharjah two-step pattern on the three heavier services:
-- one worker washes the exterior, then two workers detail the interior.
-- Everything else (Basic Wash, Premium Wash, Interior Cleaning,
-- Exterior + Interior) stays a single implicit stage, unchanged.
-- ===========================================================================

insert into service_stages (service_id, stage_order, name, worker_count, base_duration)
select s.id, v.stage_order, v.name, v.worker_count, v.base_duration
from (values
  ('Full Detailing',    1, 'Exterior Wash',   1, 20),
  ('Full Detailing',    2, 'Interior Detail', 2, 40),
  ('Deep Cleaning',      1, 'Exterior Wash',   1, 25),
  ('Deep Cleaning',      2, 'Interior Detail', 2, 50),
  ('Premium Detailing', 1, 'Exterior Wash',   1, 25),
  ('Premium Detailing', 2, 'Interior Detail', 2, 65)
) as v(service_name, stage_order, name, worker_count, base_duration)
join services s on s.service_name = v.service_name
on conflict (service_id, stage_order) do update
  set name = excluded.name,
      worker_count = excluded.worker_count,
      base_duration = excluded.base_duration;

-- ---------------------------------------------------------------------------
-- Promote a worker to a staff-portal login. Create the Auth user first
-- (Authentication → Users → Add user), then link it:
--
--   insert into profiles (id, branch_id, full_name, role, worker_id)
--   select u.id, (select id from branches limit 1), 'Ahmed', 'worker',
--          (select id from workers where name = 'Ahmed')
--   from auth.users u where u.email = 'ahmed@example.com'
--   on conflict (id) do update set role = 'worker', worker_id = excluded.worker_id;
--
--   update workers set has_account = true where name = 'Ahmed';
-- ---------------------------------------------------------------------------
