# Background Push Notifications Setup

This upgrade adds true Web Push. After this phone is registered once while you are signed in, Supabase can push a new-booking notification to the phone even when you have signed out and the schedule page is not open.

## Important

The website ZIP does **not** contain the VAPID private key or webhook secret. Those are in the separate private file `Booking-Schedule-PUSH-SECRETS-PRIVATE.txt`. Do not upload that private file to GitHub or your website.

## Step 1 — Deploy the Edge Function

Function files are included at:

`supabase/functions/send-booking-push/`

The function name must be exactly:

`send-booking-push`

Project function URL:

`https://cpvykiumvbzwbmwwfyba.supabase.co/functions/v1/send-booking-push`

Deploy it from the Supabase Dashboard or CLI. JWT verification must be disabled for this webhook function because the database webhook authenticates with the private `x-push-webhook-secret` header. The function performs its own secret check.

CLI example:

```bash
supabase functions deploy send-booking-push --no-verify-jwt
```

## Step 2 — Add Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, add the four values from the separate private setup file:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_WEBHOOK_SECRET`

Do not put the VAPID private key or webhook secret in website JavaScript.

## Step 3 — Prepare the SQL file

Open `PUSH-NOTIFICATIONS-SETUP.sql`.

Replace both occurrences of:

`REPLACE_WITH_PUSH_WEBHOOK_SECRET`

with the `PUSH_WEBHOOK_SECRET` from the private setup file.

Then run the SQL once in Supabase → SQL Editor. It creates the `push_subscriptions` table and database webhooks for Pending website bookings.

## Step 4 — Upload the new website files

Replace the previous app files with this ZIP. Make sure the new `service-worker.js`, `app.js`, `supabase-config.js` and the rest of the files are uploaded.

## Step 5 — Register your phone once

1. Open/install the hosted HTTPS app on your phone.
2. Sign in as the therapist.
3. More → Notifications.
4. Tap **Enable Background Push**.
5. Allow notifications when Android asks.
6. Tap **Test Background Push**.
7. After the server-side test arrives, you can sign out.

The push subscription stays registered in Supabase after sign-out. New website booking inserts trigger the Edge Function directly from the database, so the notification no longer depends on the admin page or Realtime listener being signed in.

## What still requires sign-in?

Receiving the notification does not require an active app login after device registration. Tapping it opens the Pending Booking screen; you still sign in before viewing/managing private booking details.

## Sound

When the app is open, the existing custom WAV chime can still play. When the PWA/browser is closed, the operating system/browser controls the push-notification sound; Web Push cannot reliably force your custom WAV file.
