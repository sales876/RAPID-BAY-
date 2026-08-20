-- ===========================================================================
-- JRHQ Car Wash — reference data + demo operational data
-- Run after schema.sql.
-- ===========================================================================

insert into branches (name, timezone)
select 'Main Branch', 'Asia/Dubai'
where not exists (select 1 from branches);

-- --- Car types -------------------------------------------------------------
insert into car_types (id, label, size_factor, sort_order) values
  ('sedan',        'Sedan',           1.00, 1),
  ('hatchback',    'Hatchback',       0.90, 2),
  ('suv',          'SUV',             1.25, 3),
  ('coupe',        'Coupe',           0.95, 4),
  ('luxury_sedan', 'Luxury Sedan',    1.20, 5),
  ('large_suv',    'Large SUV',       1.45, 6),
  ('pickup',       'Pickup / Truck',  1.40, 7),
  ('van',          'Van',             1.35, 8)
on conflict (id) do update
  set label = excluded.label,
      size_factor = excluded.size_factor,
      sort_order = excluded.sort_order;

-- --- Services --------------------------------------------------------------
insert into services (service_name, base_duration, price, sort_order) values
  ('Basic Wash',          20,  35, 1),
  ('Premium Wash',        30,  60, 2),
  ('Interior Cleaning',   25,  55, 3),
  ('Exterior + Interior', 40,  90, 4),
  ('Full Detailing',      60, 180, 5),
  ('Deep Cleaning',       75, 220, 6),
  ('Wax & Polish',        45, 140, 7),
  ('Premium Detailing',   90, 320, 8)
on conflict (service_name) do update
  set base_duration = excluded.base_duration,
      price = excluded.price,
      sort_order = excluded.sort_order;

-- --- Explicit duration overrides (car type + service) ----------------------
-- Everything not listed here resolves to base_duration * size_factor.
insert into service_durations (service_id, car_type_id, duration)
select s.id, v.car_type_id, v.duration
from (values
  ('Basic Wash',          'sedan',      20),
  ('Basic Wash',          'hatchback',  18),
  ('Basic Wash',          'suv',        25),
  ('Basic Wash',          'large_suv',  30),
  ('Basic Wash',          'pickup',     30),
  ('Premium Wash',        'sedan',      30),
  ('Premium Wash',        'suv',        40),
  ('Premium Wash',        'large_suv',  45),
  ('Exterior + Interior', 'sedan',      40),
  ('Exterior + Interior', 'suv',        50),
  ('Full Detailing',      'sedan',      60),
  ('Full Detailing',      'suv',        80),
  ('Full Detailing',      'large_suv',  90),
  ('Premium Detailing',   'luxury_sedan', 100)
) as v(service_name, car_type_id, duration)
join services s on s.service_name = v.service_name
on conflict (service_id, car_type_id) do update set duration = excluded.duration;

-- --- Workers ---------------------------------------------------------------
insert into workers (branch_id, name, status)
select b.id, w.name, 'available'::worker_status
from (values
  ('Ahmed'), ('Mohammed'), ('Arjun'), ('Raj'), ('Imran'),
  ('Sameer'), ('Bilal'), ('Hassan'), ('Rahul'), ('Faisal')
) as w(name)
cross join (select id from branches order by created_at limit 1) b
where not exists (select 1 from workers where workers.name = w.name);

-- ---------------------------------------------------------------------------
-- Promote the first signed-up account to admin. Create the user in the
-- Supabase Auth dashboard first, then run:
--
--   insert into profiles (id, branch_id, full_name, role)
--   select u.id, (select id from branches limit 1), 'Operations Manager', 'admin'
--   from auth.users u where u.email = 'manager@example.com'
--   on conflict (id) do update set role = 'admin';
-- ---------------------------------------------------------------------------
