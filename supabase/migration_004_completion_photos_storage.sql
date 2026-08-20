-- Completion photos were being stored as base64 text directly in
-- job_stages.photo_url — at ~40-80KB each, every one of those bytes rides
-- along on every job fetch (dashboard loads, realtime updates), regardless
-- of whether anyone ever looks at the photo. At 100-150 cars/day that only
-- gets worse over time.
--
-- Fix: a real storage bucket. job_stages.photo_url keeps its name and type
-- (text) — it just holds a short https:// URL now instead of the image
-- itself. No RPC changes needed; complete_stage already just stores
-- whatever string it's given.

insert into storage.buckets (id, name, public)
values ('completion-photos', 'completion-photos', true)
on conflict (id) do nothing;

-- Public bucket = anyone with the link can view (no signed-URL expiry to
-- manage, matches "a stable hyperlink in the admin"). Object keys are
-- job-id/stage-order/timestamp, not guessable, so this is the same
-- practical privacy as an "anyone with the link" Drive share — just
-- without a second vendor to configure. Writes are still locked to staff.

create policy staff_upload on storage.objects for insert
  with check (bucket_id = 'completion-photos' and is_staff());

create policy staff_replace on storage.objects for update
  using (bucket_id = 'completion-photos' and is_staff())
  with check (bucket_id = 'completion-photos' and is_staff());

create policy admin_delete on storage.objects for delete
  using (bucket_id = 'completion-photos' and is_admin());
