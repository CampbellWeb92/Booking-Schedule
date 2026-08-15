-- MASSAGE BY ASH - PUSH SUBSCRIPTION SETUP
-- Run this file ONCE in Supabase Dashboard -> SQL Editor.

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

drop policy if exists "Admins can view own push subscriptions"
on public.push_subscriptions;

create policy "Admins can view own push subscriptions"
on public.push_subscriptions
for select
to authenticated
using (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'infocampbellweb@gmail.com'
);

drop policy if exists "Admins can register own push subscriptions"
on public.push_subscriptions;

create policy "Admins can register own push subscriptions"
on public.push_subscriptions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'infocampbellweb@gmail.com'
);

drop policy if exists "Admins can update own push subscriptions"
on public.push_subscriptions;

create policy "Admins can update own push subscriptions"
on public.push_subscriptions
for update
to authenticated
using (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'infocampbellweb@gmail.com'
)
with check (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'infocampbellweb@gmail.com'
);

drop policy if exists "Admins can delete own push subscriptions"
on public.push_subscriptions;

create policy "Admins can delete own push subscriptions"
on public.push_subscriptions
for delete
to authenticated
using (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'infocampbellweb@gmail.com'
);

grant select, insert, update, delete
on public.push_subscriptions
to authenticated;

create or replace function public.touch_push_subscription()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_push_subscription
on public.push_subscriptions;

create trigger trg_touch_push_subscription
before update on public.push_subscriptions
for each row
execute function public.touch_push_subscription();

commit;
