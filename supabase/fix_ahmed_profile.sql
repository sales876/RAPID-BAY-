-- Ahmed's auth account (ahmed@carwash.app) authenticates fine but has no
-- row in `profiles`, so the app falls back to role='receptionist' and shows
-- the admin shell instead of /staff. Create/fix his profile, linked to his
-- floor identity in `workers`.
insert into profiles (id, full_name, role)
values ('a1215547-43a6-4359-90d1-e4ab1f5be507', 'Ahmed', 'worker')
on conflict (id) do update set role = 'worker', full_name = 'Ahmed';

update profiles set worker_id = 'aff2b1ea-1afd-4224-aef5-79e64d9e7009'
where id = 'a1215547-43a6-4359-90d1-e4ab1f5be507';

update workers set has_account = true
where id = 'aff2b1ea-1afd-4224-aef5-79e64d9e7009';
