MASSAGE BY ASH — SCHEDULE APP / WEBSITE SYNC
============================================

This app has been updated to the same booking/schedule model used by the current website.

SYNCED FEATURES
---------------
• Same Supabase project credentials as the website.
• Public schedule mirror (public_schedule_days).
• Confirmed appointment/manual-block mirror (public_schedule_blocks).
• Public client availability notes (public_note).
• Custom opening hours for individual dates.
• Public-holiday overrides.
• Pending website booking requests in appointments.
• Pending -> Confirmed / Cancelled workflow.
• Confirmed appointment ranges rather than fixed 60-minute blocks.
• Default admin booking duration = 30 minutes.
• 30/60/90/120-minute appointment choices.
• 0/15/30-minute booking buffers in the add-booking form.
• Closing-time protection uses the ACTUAL appointment duration.
• Buffer time may continue after closing; the client's appointment may not.
• Manual time-range blocks.
• Booking rules: default buffer, minimum notice, advance-booking window.
• Activity history and undo for date changes.
• Date-range blocking with a public notice.
• Supabase Realtime listeners for schedule, appointment, history, holiday and settings changes.

IMPORTANT DATABASE STEP
-----------------------
If you have ALREADY run the Full Booking System / SUPABASE-UPGRADE.sql supplied with the
website upgrade, you do not need to run SQL again.

If the app shows errors such as a missing public_schedule_days, appointments,
holiday_overrides, schedule_settings or schedule_audit table, run supabase-setup.sql
from this folder once in Supabase Dashboard -> SQL Editor. It is designed to upgrade
the existing schedule rather than discard it.

GITHUB / HOSTING
----------------
Upload the CONTENTS of this folder to the root of the Schedule App repository.
index.html should be at the repository root — do not upload this folder as another
wrapper folder.

PWA CACHE
---------
The service worker uses the current v7 cache. After uploading, refresh the app. If an
installed shortcut still shows the old version, close it completely and reopen it; if
needed, remove and reinstall the shortcut/PWA once.
