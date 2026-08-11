-- KEEP COMPLETED BOOKINGS BLOCKED
-- Run this ONCE in Supabase Dashboard -> SQL Editor on an existing installation.
--
-- This keeps a booked time unavailable after the appointment is marked Completed.
-- Cancelled appointments are still released.

begin;

-- 1) Completed bookings must continue to mirror into the sanitized public block table.
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
    insert into public.public_schedule_blocks(
      appointment_id, day, start_time, end_time, kind, public_note, updated_at
    )
    values (
      new.id, new.day, new.start_time, new.blocked_until_time,
      new.kind, coalesce(new.public_note, ''), now()
    )
    on conflict (appointment_id) do update set
      day = excluded.day,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      kind = excluded.kind,
      public_note = excluded.public_note,
      updated_at = now();
  else
    -- Pending and Cancelled appointments do not block availability.
    delete from public.public_schedule_blocks where appointment_id = new.id;
  end if;

  return new;
end;
$$;

-- 2) Rebuild the overlap protection so Completed bookings are protected too.
--    This prevents a second confirmed/completed appointment from being put
--    over a historical completed booking range on the same date.
alter table public.appointments
  drop constraint if exists appointments_no_confirmed_overlap;

alter table public.appointments
  add constraint appointments_no_confirmed_overlap
  exclude using gist (
    day with =,
    tsrange(day + start_time, day + blocked_until_time, '[)') with &&
  ) where (status in ('confirmed','completed'));

-- 3) Backfill any appointments that were already completed before this fix.
insert into public.public_schedule_blocks(
  appointment_id, day, start_time, end_time, kind, public_note, updated_at
)
select
  id, day, start_time, blocked_until_time, kind, public_note, now()
from public.appointments
where status in ('confirmed','completed')
on conflict (appointment_id) do update set
  day = excluded.day,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  kind = excluded.kind,
  public_note = excluded.public_note,
  updated_at = now();

-- Remove blocks only for records that should genuinely be available again.
delete from public.public_schedule_blocks b
where exists (
  select 1
  from public.appointments a
  where a.id = b.appointment_id
    and a.status not in ('confirmed','completed')
);

commit;
