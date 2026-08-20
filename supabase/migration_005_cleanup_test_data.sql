-- Final cleanup before go-live: everything under this session was test data
-- (burst tests, throwaway services, probe jobs). Wipes all transactional
-- records — jobs, their stages, notifications, customers, vehicles — back to
-- an empty, ready-for-real-use state.
--
-- Deliberately NOT touched: workers, services, service_stages, car_types —
-- your actual business configuration (roster, pricing, catalog). Also not
-- touched: push_subscriptions (real device subscriptions) and profiles
-- (real logins).
--
-- job_stages and notifications both reference jobs with `on delete cascade`,
-- so deleting jobs clears those automatically. Customers and vehicles are
-- only `on delete set null` from jobs, so they need their own delete.

delete from jobs;
delete from vehicles;
delete from customers;
