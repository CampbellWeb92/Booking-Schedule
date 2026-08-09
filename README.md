# CampbellWeb Supabase Schedule

This is the live, multi-device version of the schedule app.

## What changed

- Availability is stored in Supabase instead of browser localStorage.
- Therapist authentication uses Supabase Auth.
- Only `infocampbellweb@gmail.com` may modify schedule rows under the included RLS policies.
- Public visitors can read availability without logging in.
- Realtime updates refresh open schedules when availability changes.

## 1. Create a Supabase project

Create/open your Supabase project.

## 2. Create the therapist login

In Supabase Dashboard:

Authentication → Users → Add user / Create new user

Email:
`infocampbellweb@gmail.com`

Password:
Use the password you want for the therapist login.

For the credentials requested when this app was first made, use the password already specified by the site owner.

Do NOT put the password in any JavaScript file.

## 3. Create the database

Open:

SQL Editor → New query

Paste the complete contents of `supabase-setup.sql`, then run it once.

This creates `public.schedule_days`, enables Row Level Security, adds public read permissions, allows only the specified therapist email to edit, and enables Realtime Postgres Changes.

If the final publication line says `schedule_days` is already a member of `supabase_realtime`, it can be ignored.

## 4. Add your project credentials

Open `supabase-config.js`.

Replace:

`PASTE_YOUR_SUPABASE_PROJECT_URL_HERE`

and:

`PASTE_YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE`

You can copy these from your Supabase project API settings.

Use a browser-safe publishable key / anon key. NEVER paste a `service_role` or secret key into this website.

## 5. Upload/deploy

Upload these files together:

- index.html
- styles.css
- app.js
- supabase-config.js

You can host the folder with GitHub Pages, Netlify, Cloudflare Pages, or another normal static web host.

## How it works

Visitors:
- See live available dates/times.
- Do not need an account.
- Cannot edit availability.

Therapist:
- Clicks Therapist Login.
- Logs in with Supabase Auth.
- Selects any calendar date.
- Blocks the entire date OR individual hours.
- Can add a custom time.
- Can add a private note.
- Clicks Save changes.
- The changes are written to Supabase and become visible across devices.

## Security

The public Supabase browser key is not treated as an admin password. Security comes from Row Level Security. The included RLS policies grant public SELECT only and grant INSERT/UPDATE/DELETE only to an authenticated JWT whose email is `infocampbellweb@gmail.com`.

Never use the Supabase service-role key in frontend/browser code.


## Automatic business hours

The latest version automatically follows these hours:

- Tuesday–Friday: 09:00–17:00
- Saturday: 09:00–15:00
- Sunday: Closed
- Monday: Closed
- South African public holidays: 09:00–15:00

Public holiday hours override the normal Sunday/Monday closure. If a statutory public holiday falls on a Sunday, the following Monday is also treated as a public holiday.

You can still manually:
- block an entire date;
- block individual hours;
- clear a date to restore the automatic business hours.

The app calculates the standard South African statutory public holidays, including Good Friday and Family Day, in the browser. One-off public holidays specially proclaimed by government would need to be added to the code if one is announced.


## Massage by Ash visual update

- `images/logo.jpg` is used in the header.
- `images/background.png` is used as the full-page background.
- Time choices now display in `09h00`, `09h15`, `09h30` format.
- Tuesday-Friday use the time sequence from 09h00 through 17h00.
- Saturday and public holidays use the sequence from 09h00 through 15h00.
- Sundays and Mondays remain automatically closed except public holidays.
- Manual Supabase blocks still override the automatic schedule.


## Public Notes

The therapist dashboard field is now called **Notes**. Notes saved for a date are displayed publicly when a visitor selects that date. A small gold indicator appears on calendar dates that have a note.
