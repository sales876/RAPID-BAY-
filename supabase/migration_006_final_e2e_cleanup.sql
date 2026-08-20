-- Removes the two test jobs created during the final end-to-end verification
-- pass (E2E FINAL 01, E2E CANCEL 01) and their customer/vehicle records.
-- job_stages and notifications cascade automatically from jobs.
-- Nothing else in the database is touched.

delete from jobs where plate_number in ('E2E FINAL 01', 'E2E CANCEL 01');
delete from vehicles where upper(plate_number) in ('E2E FINAL 01', 'E2E CANCEL 01');
delete from customers where name in ('E2E Final Test', 'E2E Cancel Test');
