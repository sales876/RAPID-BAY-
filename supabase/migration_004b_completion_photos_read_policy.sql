-- migration_004 made the bucket public (so <img> tags and shared links work
-- with no auth), but public reads go through a separate endpoint
-- (/object/public/...) that bypasses storage.objects RLS entirely — it
-- never needed a SELECT policy. Admin operations do go through RLS, though:
-- without a SELECT policy, the bulk-delete endpoint can't even find a row
-- to remove (it returns 200 with an empty result, silently doing nothing).
-- This is what admin_delete was missing.

create policy staff_read on storage.objects for select
  using (bucket_id = 'completion-photos' and is_staff());
