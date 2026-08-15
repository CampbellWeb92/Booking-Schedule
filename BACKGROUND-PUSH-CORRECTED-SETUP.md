# Background Push — Corrected Supabase Setup

The previous SQL used:

`supabase_functions.http_request(...)`

Your Supabase project does not expose that schema, so that statement fails.

## 1. Run the corrected SQL

Run:

`PUSH-SUBSCRIPTIONS-ONLY-NO-SUPABASE-FUNCTIONS.sql`

in:

**Supabase Dashboard → SQL Editor**

This only creates the phone push-subscription table and RLS policies.

## 2. Deploy the Edge Function

Deploy the included function:

`supabase/functions/send-booking-push/index.ts`

Function name:

`send-booking-push`

Configure it so JWT verification is disabled for the webhook endpoint.

Add these Edge Function secrets:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_WEBHOOK_SECRET`

Use the values from the private setup file generated for this app.

## 3. Create the webhook in the Dashboard

Go to:

**Database → Webhooks → Create a new webhook**

Use:

- Name: `send-new-booking-push`
- Table: `public.appointments`
- Event: `INSERT`
- Type: HTTP Request
- Method: `POST`
- URL:
  `https://cpvykiumvbzwbmwwfyba.supabase.co/functions/v1/send-booking-push`

Add HTTP headers:

- `Content-Type` = `application/json`
- `x-push-webhook-secret` = your `PUSH_WEBHOOK_SECRET`

Do not put your VAPID private key in the webhook headers.

The Edge Function itself checks that the inserted appointment is:

- `kind = booking`
- `status = pending`
- `source = website`

Other appointment inserts are ignored.

## 4. Test

1. Upload the new app files.
2. Sign in once.
3. Go to More → Notifications.
4. Enable Background Push.
5. Allow notification permission.
6. Run Test Background Push.
7. Sign out.
8. Submit a new website booking.

If the server-side test works but the real booking does not, inspect:

**Edge Functions → send-booking-push → Logs**

and:

**Database → Webhooks → Logs / request history** (where available).
