-- CampbellWeb Schedule - Supabase setup
-- Run this entire file once in Supabase Dashboard → SQL Editor.

create table if not exists public.schedule_days (
  day date primary key,
  whole_day boolean not null default false,
  blocked_slots text[] not null default '{}',
  custom_slots text[] not null default '{}',
  private_note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.schedule_days enable row level security;

-- Public visitors may read availability.
drop policy if exists "Public can read schedule" on public.schedule_days;
create policy "Public can read schedule"
on public.schedule_days
for select
to anon, authenticated
using (true);

-- Only the CampbellWeb therapist account may add/update/delete schedule rows.
-- This checks the authenticated Supabase email claim.
drop policy if exists "CampbellWeb admin can insert schedule" on public.schedule_days;
create policy "CampbellWeb admin can insert schedule"
on public.schedule_days
for insert
to authenticated
with check (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'infocampbellweb@gmail.com'
);

drop policy if exists "CampbellWeb admin can update schedule" on public.schedule_days;
create policy "CampbellWeb admin can update schedule"
on public.schedule_days
for update
to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'infocampbellweb@gmail.com'
)
with check (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'infocampbellweb@gmail.com'
);

drop policy if exists "CampbellWeb admin can delete schedule" on public.schedule_days;
create policy "CampbellWeb admin can delete schedule"
on public.schedule_days
for delete
to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'infocampbellweb@gmail.com'
);

-- Allow Realtime Postgres Changes for this table.
-- If Supabase says the table is already in the publication, you can ignore that message.
alter publication supabase_realtime add table public.schedule_days;
