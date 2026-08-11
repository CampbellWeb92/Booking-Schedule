-- Massage by Ash - Full Schedule & Booking Upgrade
-- Run ONCE in Supabase Dashboard -> SQL Editor.
-- Safe to re-run: objects/policies are created or replaced where practical.

begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Admin accounts (removes hard-coded email checks from database policies)
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_admins (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.schedule_admins(email, active)
values ('infocampbellweb@gmail.com', true)
on conflict (email) do update set active = excluded.active;

alter table public.schedule_admins enable row level security;

create or replace function public.is_schedule_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.schedule_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and a.active = true
  );
$$;

revoke all on function public.is_schedule_admin() from public;
grant execute on function public.is_schedule_admin() to authenticated;

drop policy if exists "Admins can view own schedule admin record" on public.schedule_admins;
create policy "Admins can view own schedule admin record"
on public.schedule_admins for select to authenticated
using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and active = true);

drop policy if exists "Admins can manage schedule admins" on public.schedule_admins;
create policy "Admins can manage schedule admins"
on public.schedule_admins for all to authenticated
using (public.is_schedule_admin())
with check (public.is_schedule_admin());

grant select, insert, update, delete on public.schedule_admins to authenticated;

-- ---------------------------------------------------------------------------
-- Existing day-level schedule, upgraded with public_note.
-- custom_slots is now actively used as an exact custom-hours slot list.
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_days (
  day date primary key,
  whole_day boolean not null default false,
  blocked_slots text[] not null default '{}',
  custom_slots text[] not null default '{}',
  private_note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.schedule_days
  add column if not exists public_note text not null default '';

update public.schedule_days
set public_note = private_note
where coalesce(public_note, '') = '' and coalesce(private_note, '') <> '';

-- Keep the old column in sync for compatibility with older deployed builds.
create or replace function public.sync_schedule_note_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.public_note, '') = '' and coalesce(new.private_note, '') <> '' then
    new.public_note := new.private_note;
  end if;
  new.private_note := coalesce(new.public_note, '');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sync_schedule_note_columns on public.schedule_days;
create trigger trg_sync_schedule_note_columns
before insert or update on public.schedule_days
for each row execute function public.sync_schedule_note_columns();

alter table public.schedule_days enable row level security;

drop policy if exists "Public can read schedule" on public.schedule_days;
drop policy if exists "CampbellWeb admin can insert schedule" on public.schedule_days;
drop policy if exists "CampbellWeb admin can update schedule" on public.schedule_days;
drop policy if exists "CampbellWeb admin can delete schedule" on public.schedule_days;
drop policy if exists "Schedule admins can read schedule" on public.schedule_days;
drop policy if exists "Schedule admins can insert schedule" on public.schedule_days;
drop policy if exists "Schedule admins can update schedule" on public.schedule_days;
drop policy if exists "Schedule admins can delete schedule" on public.schedule_days;

create policy "Schedule admins can read schedule"
on public.schedule_days for select to authenticated
using (public.is_schedule_admin());
create policy "Schedule admins can insert schedule"
on public.schedule_days for insert to authenticated
with check (public.is_schedule_admin());
create policy "Schedule admins can update schedule"
on public.schedule_days for update to authenticated
using (public.is_schedule_admin()) with check (public.is_schedule_admin());
create policy "Schedule admins can delete schedule"
on public.schedule_days for delete to authenticated
using (public.is_schedule_admin());

grant select, insert, update, delete on public.schedule_days to authenticated;

-- Sanitized public mirror. No private/admin-only columns are exposed here.
create table if not exists public.public_schedule_days (
  day date primary key,
  whole_day boolean not null default false,
  blocked_slots text[] not null default '{}',
  custom_slots text[] not null default '{}',
  public_note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.public_schedule_days enable row level security;
drop policy if exists "Anyone can read public schedule days" on public.public_schedule_days;
create policy "Anyone can read public schedule days"
on public.public_schedule_days for select to anon, authenticated using (true);

grant select on public.public_schedule_days to anon, authenticated;

create or replace function public.mirror_schedule_day_public()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.public_schedule_days where day = old.day;
    return old;
  end if;

  insert into public.public_schedule_days(day, whole_day, blocked_slots, custom_slots, public_note, updated_at)
  values (new.day, new.whole_day, new.blocked_slots, new.custom_slots, coalesce(new.public_note, ''), now())
  on conflict (day) do update set
    whole_day = excluded.whole_day,
    blocked_slots = excluded.blocked_slots,
    custom_slots = excluded.custom_slots,
    public_note = excluded.public_note,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mirror_schedule_day_public on public.schedule_days;
create trigger trg_mirror_schedule_day_public
after insert or update or delete on public.schedule_days
for each row execute function public.mirror_schedule_day_public();

insert into public.public_schedule_days(day, whole_day, blocked_slots, custom_slots, public_note, updated_at)
select day, whole_day, blocked_slots, custom_slots, coalesce(public_note, private_note, ''), now()
from public.schedule_days
on conflict (day) do update set
  whole_day = excluded.whole_day,
  blocked_slots = excluded.blocked_slots,
  custom_slots = excluded.custom_slots,
  public_note = excluded.public_note,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Settings: buffer, notice period, booking horizon.
-- Public read is intentional because the website must enforce/display them.
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_settings (
  id smallint primary key default 1 check (id = 1),
  default_buffer_minutes integer not null default 15 check (default_buffer_minutes between 0 and 120),
  min_notice_minutes integer not null default 120 check (min_notice_minutes between 0 and 10080),
  max_advance_days integer not null default 60 check (max_advance_days between 1 and 365),
  updated_at timestamptz not null default now()
);
insert into public.schedule_settings(id) values (1) on conflict (id) do nothing;
alter table public.schedule_settings enable row level security;
drop policy if exists "Anyone can read schedule settings" on public.schedule_settings;
drop policy if exists "Admins can update schedule settings" on public.schedule_settings;
create policy "Anyone can read schedule settings"
on public.schedule_settings for select to anon, authenticated using (true);
create policy "Admins can update schedule settings"
on public.schedule_settings for update to authenticated
using (public.is_schedule_admin()) with check (public.is_schedule_admin());

grant select on public.schedule_settings to anon, authenticated;
grant update on public.schedule_settings to authenticated;

create or replace function public.touch_schedule_settings()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_touch_schedule_settings on public.schedule_settings;
create trigger trg_touch_schedule_settings before update on public.schedule_settings
for each row execute function public.touch_schedule_settings();

-- ---------------------------------------------------------------------------
-- Editable public-holiday overrides.
-- mode: holiday=open as holiday, normal=ignore automatic holiday, closed=closed.
-- custom_slots may override the normal holiday hours.
-- ---------------------------------------------------------------------------
create table if not exists public.holiday_overrides (
  day date primary key,
  name text not null default '',
  mode text not null default 'holiday' check (mode in ('holiday','normal','closed')),
  custom_slots text[] not null default '{}',
  public_note text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.holiday_overrides enable row level security;
drop policy if exists "Anyone can read holiday overrides" on public.holiday_overrides;
drop policy if exists "Admins can manage holiday overrides" on public.holiday_overrides;
create policy "Anyone can read holiday overrides"
on public.holiday_overrides for select to anon, authenticated using (true);
create policy "Admins can manage holiday overrides"
on public.holiday_overrides for all to authenticated
using (public.is_schedule_admin()) with check (public.is_schedule_admin());

grant select on public.holiday_overrides to anon, authenticated;
grant insert, update, delete on public.holiday_overrides to authenticated;

-- ---------------------------------------------------------------------------
-- Appointments and time-range blocks.
-- Pending website requests do NOT block the public calendar until confirmed.
-- blocked_until_time includes the cleanup/buffer period.
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  start_time time not null,
  end_time time not null,
  blocked_until_time time not null,
  duration_minutes integer not null check (duration_minutes between 1 and 720),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 120),
  kind text not null default 'booking' check (kind in ('booking','manual_block')),
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','completed')),
  service text not null default '',
  client_name text not null default '',
  client_phone text not null default '',
  client_type text not null default '',
  client_notes text not null default '',
  public_note text not null default '',
  source text not null default 'admin' check (source in ('admin','website')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  check (blocked_until_time >= end_time)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='appointments_text_lengths' and conrelid='public.appointments'::regclass) then
    alter table public.appointments add constraint appointments_text_lengths check (
      char_length(service) <= 200 and char_length(client_name) <= 120 and char_length(client_phone) <= 60
      and char_length(client_type) <= 40 and char_length(client_notes) <= 2000 and char_length(public_note) <= 500
    );
  end if;
end $$;

alter table public.appointments enable row level security;

drop policy if exists "Website can submit pending booking requests" on public.appointments;
drop policy if exists "Schedule admins can read appointments" on public.appointments;
drop policy if exists "Schedule admins can insert appointments" on public.appointments;
drop policy if exists "Schedule admins can update appointments" on public.appointments;
drop policy if exists "Schedule admins can delete appointments" on public.appointments;

create policy "Website can submit pending booking requests"
on public.appointments for insert to anon
with check (
  status = 'pending'
  and kind = 'booking'
  and source = 'website'
  and buffer_minutes = 0
  and blocked_until_time = end_time
);
create policy "Schedule admins can read appointments"
on public.appointments for select to authenticated using (public.is_schedule_admin());
create policy "Schedule admins can insert appointments"
on public.appointments for insert to authenticated with check (public.is_schedule_admin());
create policy "Schedule admins can update appointments"
on public.appointments for update to authenticated
using (public.is_schedule_admin()) with check (public.is_schedule_admin());
create policy "Schedule admins can delete appointments"
on public.appointments for delete to authenticated using (public.is_schedule_admin());

grant insert on public.appointments to anon;
grant select, insert, update, delete on public.appointments to authenticated;

create or replace function public.touch_appointment()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_touch_appointment on public.appointments;
create trigger trg_touch_appointment before update on public.appointments
for each row execute function public.touch_appointment();

-- Database-level protection against overlapping CONFIRMED ranges.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_no_confirmed_overlap'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_no_confirmed_overlap
      exclude using gist (
        day with =,
        tsrange(day + start_time, day + blocked_until_time, '[)') with &&
      ) where (status in ('confirmed','completed'));
  end if;
end $$;

-- Sanitized confirmed ranges for public availability. No client data.
create table if not exists public.public_schedule_blocks (
  appointment_id uuid primary key,
  day date not null,
  start_time time not null,
  end_time time not null,
  kind text not null,
  public_note text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists public_schedule_blocks_day_idx on public.public_schedule_blocks(day);
alter table public.public_schedule_blocks enable row level security;
drop policy if exists "Anyone can read public schedule blocks" on public.public_schedule_blocks;
create policy "Anyone can read public schedule blocks"
on public.public_schedule_blocks for select to anon, authenticated using (true);

grant select on public.public_schedule_blocks to anon, authenticated;

create or replace function public.mirror_appointment_public_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.public_schedule_blocks where appointment_id = old.id;
    return old;
  end if;

  if new.status in ('confirmed','completed') then
    insert into public.public_schedule_blocks(appointment_id, day, start_time, end_time, kind, public_note, updated_at)
    values (new.id, new.day, new.start_time, new.blocked_until_time, new.kind, coalesce(new.public_note, ''), now())
    on conflict (appointment_id) do update set
      day = excluded.day,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      kind = excluded.kind,
      public_note = excluded.public_note,
      updated_at = now();
  else
    delete from public.public_schedule_blocks where appointment_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mirror_appointment_public_block on public.appointments;
create trigger trg_mirror_appointment_public_block
after insert or update or delete on public.appointments
for each row execute function public.mirror_appointment_public_block();

insert into public.public_schedule_blocks(appointment_id, day, start_time, end_time, kind, public_note, updated_at)
select id, day, start_time, blocked_until_time, kind, public_note, now()
from public.appointments
where status in ('confirmed','completed')
on conflict (appointment_id) do update set
  day = excluded.day,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  kind = excluded.kind,
  public_note = excluded.public_note,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Audit history + Undo for day-level schedule changes.
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_audit (
  id bigint generated by default as identity primary key,
  table_name text not null,
  action text not null,
  record_key text not null default '',
  old_row jsonb,
  new_row jsonb,
  actor_email text not null default '',
  changed_at timestamptz not null default now()
);
create index if not exists schedule_audit_changed_idx on public.schedule_audit(changed_at desc);
alter table public.schedule_audit enable row level security;
drop policy if exists "Admins can read schedule audit" on public.schedule_audit;
create policy "Admins can read schedule audit"
on public.schedule_audit for select to authenticated using (public.is_schedule_admin());

grant select on public.schedule_audit to authenticated;

create or replace function public.audit_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  key_text text;
begin
  if tg_table_name = 'schedule_days' then
    key_text := coalesce(new.day::text, old.day::text, '');
  elsif tg_table_name = 'appointments' then
    key_text := coalesce(new.id::text, old.id::text, '');
  elsif tg_table_name = 'holiday_overrides' then
    key_text := coalesce(new.day::text, old.day::text, '');
  elsif tg_table_name = 'schedule_settings' then
    key_text := '1';
  else
    key_text := '';
  end if;

  insert into public.schedule_audit(table_name, action, record_key, old_row, new_row, actor_email)
  values (
    tg_table_name,
    tg_op,
    key_text,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    lower(coalesce(auth.jwt() ->> 'email', 'system'))
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_schedule_days on public.schedule_days;
create trigger trg_audit_schedule_days after insert or update or delete on public.schedule_days
for each row execute function public.audit_schedule_change();
drop trigger if exists trg_audit_appointments on public.appointments;
create trigger trg_audit_appointments after insert or update or delete on public.appointments
for each row execute function public.audit_schedule_change();
drop trigger if exists trg_audit_holidays on public.holiday_overrides;
create trigger trg_audit_holidays after insert or update or delete on public.holiday_overrides
for each row execute function public.audit_schedule_change();
drop trigger if exists trg_audit_settings on public.schedule_settings;
create trigger trg_audit_settings after update on public.schedule_settings
for each row execute function public.audit_schedule_change();

create or replace function public.undo_last_schedule_day_change(p_day date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.schedule_audit%rowtype;
  r jsonb;
begin
  if not public.is_schedule_admin() then
    raise exception 'Not authorized';
  end if;

  select * into a
  from public.schedule_audit
  where table_name = 'schedule_days' and record_key = p_day::text
  order by changed_at desc, id desc
  limit 1;

  if not found then return 'No history for this date.'; end if;

  if a.action = 'INSERT' and a.old_row is null then
    delete from public.schedule_days where day = p_day;
    return 'Undid newly-created day override.';
  end if;

  r := a.old_row;
  if r is null then return 'Nothing to restore.'; end if;

  insert into public.schedule_days(day, whole_day, blocked_slots, custom_slots, public_note, private_note, updated_at)
  values (
    (r->>'day')::date,
    coalesce((r->>'whole_day')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(r->'blocked_slots')), '{}'),
    coalesce(array(select jsonb_array_elements_text(r->'custom_slots')), '{}'),
    coalesce(r->>'public_note', r->>'private_note', ''),
    coalesce(r->>'public_note', r->>'private_note', ''),
    now()
  )
  on conflict (day) do update set
    whole_day = excluded.whole_day,
    blocked_slots = excluded.blocked_slots,
    custom_slots = excluded.custom_slots,
    public_note = excluded.public_note,
    private_note = excluded.private_note,
    updated_at = now();

  return 'Previous schedule state restored.';
end;
$$;
revoke all on function public.undo_last_schedule_day_change(date) from public;
grant execute on function public.undo_last_schedule_day_change(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime publications, idempotently.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['public_schedule_days','public_schedule_blocks','holiday_overrides','schedule_settings','appointments','schedule_audit'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;

-- Optional cleanup after ALL old website/app versions are retired:
-- alter table public.schedule_days drop column private_note;
