-- Massage by Ash - Background Web Push setup
-- Run this once in Supabase Dashboard -> SQL Editor.
-- This file creates the device-subscription table and the booking webhook.
-- IMPORTANT: before running, replace REPLACE_WITH_PUSH_WEBHOOK_SECRET with the
-- PUSH_WEBHOOK_SECRET from the separate private setup file.

begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  device_label text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Admins can view own push subscriptions" on public.push_subscriptions;
create policy "Admins can view own push subscriptions"
on public.push_subscriptions for select to authenticated
using (user_id=auth.uid() and public.is_schedule_admin());

drop policy if exists "Admins can register own push subscriptions" on public.push_subscriptions;
create policy "Admins can register own push subscriptions"
on public.push_subscriptions for insert to authenticated
with check (user_id=auth.uid() and public.is_schedule_admin());

drop policy if exists "Admins can update own push subscriptions" on public.push_subscriptions;
create policy "Admins can update own push subscriptions"
on public.push_subscriptions for update to authenticated
using (user_id=auth.uid() and public.is_schedule_admin())
with check (user_id=auth.uid() and public.is_schedule_admin());

drop policy if exists "Admins can delete own push subscriptions" on public.push_subscriptions;
create policy "Admins can delete own push subscriptions"
on public.push_subscriptions for delete to authenticated
using (user_id=auth.uid() and public.is_schedule_admin());

grant select,insert,update,delete on public.push_subscriptions to authenticated;

create or replace function public.touch_push_subscription()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;

drop trigger if exists trg_touch_push_subscription on public.push_subscriptions;
create trigger trg_touch_push_subscription
before update on public.push_subscriptions
for each row execute function public.touch_push_subscription();

-- Database Webhooks are asynchronous pg_net-backed triggers.
-- This fires only for new website booking requests that are Pending.
drop trigger if exists trg_send_new_booking_push on public.appointments;
create trigger trg_send_new_booking_push
after insert on public.appointments
for each row
when (new.kind='booking' and new.status='pending' and new.source='website')
execute function supabase_functions.http_request(
  'https://cpvykiumvbzwbmwwfyba.supabase.co/functions/v1/send-booking-push',
  'POST',
  '{"Content-Type":"application/json","x-push-webhook-secret":"5LbghXAD1NfKeDHQDvG5_PsP1Z1weBnmZNkLb3wpDhU"}',
  '{}',
  '5000'
);

-- Also notify if an existing website booking is changed into Pending.
drop trigger if exists trg_send_booking_push_on_pending_update on public.appointments;
create trigger trg_send_booking_push_on_pending_update
after update of status on public.appointments
for each row
when (new.kind='booking' and new.status='pending' and new.source='website' and old.status is distinct from 'pending')
execute function supabase_functions.http_request(
  'https://cpvykiumvbzwbmwwfyba.supabase.co/functions/v1/send-booking-push',
  'POST',
  '{"Content-Type":"application/json","x-push-webhook-secret":"5LbghXAD1NfKeDHQDvG5_PsP1Z1weBnmZNkLb3wpDhU"}',
  '{}',
  '5000'
);

commit;
