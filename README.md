# Massage by Ash Schedule App

This version is connected to Supabase and includes the complete usability upgrade.

## Automatic business hours

- Tuesday–Friday: 09h00–17h00
- Saturday: 09h00–15h00
- Sunday: Closed
- Monday: Closed
- South African public holidays: 09h00–15h00

Available time choices use the requested pattern:
09h00, 09h15, 09h30, 10h00, 10h15, 10h30, etc.

## Therapist controls

- Block an entire date
- Block individual times
- Block the morning
- Block the afternoon
- Restore normal automatic hours
- Add public Notes to a date
- Copy one date's availability and note to another date
- Block a date range for leave/off days
- Clear a date back to automatic hours
- Today button for fast navigation

## Public calendar

- Equal-width calendar and Available Times panels on desktop
- Mobile-friendly stacked layout
- Emerald = available
- Gold = limited / public holiday accents
- Black/grey = closed or blocked
- Gold star = public holiday
- Gold dot = Notes available
- Notes display publicly when a date is selected
- Only available times are shown

## Install on a phone

The app includes a web app manifest and service worker, so it can be installed as a PWA after it is hosted over HTTPS.

On Android/Chrome, use the **Install App** button when it appears or Chrome's Add to Home Screen option.

On iPhone/Safari, open the hosted site, tap Share, then **Add to Home Screen**.

The PWA install feature does not fully work when opening `index.html` directly from the Files app. Host the app using GitHub Pages, Netlify, Cloudflare Pages, or another HTTPS host.

## Supabase

The existing `supabase-config.js` remains included. The app stores manual date blocks, time blocks, and Notes in the existing `schedule_days` table.

The `private_note` database column is retained for compatibility, but the app now intentionally displays its contents publicly as **Notes**.

## Important security note

Never place a Supabase `service_role` or secret key in the browser files. Use only the publishable/anon browser key.


## Professional design update

- Header logo now stands alone with no CSS-added circular border or gold ring.
- Added WhatsApp links to 079 556 7466 using the international WhatsApp link.
- Added direct website links to https://massagebyash.co.za.
- Added elegant hero contact buttons and a contact footer.
- Refined calendar typography, spacing, borders, status styling, panels, time buttons, and therapist dashboard.
- Maintains responsive mobile layout and PWA/Supabase functionality.


## Corrected logo/header update

- The header now uses `images/logo-transparent.png`.
- The black logo background and original outer gold circular border have been removed.
- The logo is displayed standalone with no CSS border, ring, background, or shadow.
- WhatsApp and Website buttons were removed from beside Therapist Login.
- The main-page WhatsApp and Website contact buttons remain available.


## Reference-style redesign

The public schedule has been redesigned to closely match the supplied visual reference:

- Centered standalone transparent Massage by Ash logo
- No circular logo border
- Sign In button in the upper-right corner
- Monday-first calendar
- White calendar and Available Times cards
- Dark emerald weekday/time headers
- Gold selected / limited accents
- Notes banner above available times
- Horizontal Business Hours strip
- Bottom Get In Touch area with WhatsApp and website links
- Emerald/gold/black luxury background treatment
- Responsive mobile layout

All existing Supabase functionality, live sync, manual blocking, date-range blocking,
public notes, automatic business hours and PWA support are retained.


## Booking notification reliability fix

- Test Alert now enables real booking alerts too.
- Realtime subscription failures automatically retry.
- Authenticated fallback checking runs every 15 seconds while alerts are enabled.
- Focus, visibility and online events trigger an immediate catch-up check.
- Sound uses the bundled WAV first and a Web Audio fallback chime if needed.
- Service worker cache is now v10 to force installed phones to receive the corrected app files.
\n\n## Completed bookings remain blocked\n\nThis build changes booking availability so **Completed** appointments remain blocked on the public schedule, just like Confirmed appointments. Cancelled bookings are still released.\n\nFor an existing Supabase project, run `KEEP-COMPLETED-BOOKINGS-BLOCKED.sql` once in the Supabase SQL Editor. It updates the mirror trigger, overlap protection, and backfills bookings that were already completed.\n
## Dashboard navigation upgrade (August 2026)

The therapist dashboard has been reorganised for faster phone use:

- **Today at a glance** shows today's confirmed count, pending requests, the next booking, and selected-date status.
- **Calendar** keeps the common actions visible: Block Entire Day, Block Morning, Block Afternoon, Restore Hours and Add Booking.
- Less-used controls are now under **Advanced Options**: custom hours, individual time blocking, public notices, holiday overrides, time-range blocks, copying availability and leave/date-range blocking.
- **Bookings** is divided into Pending Requests, Today, Upcoming, Past Confirmed, Completed and Cancelled.
- Completed and Cancelled history groups are collapsed by default to keep the dashboard tidy.
- Booking cards are colour-coded by status and pending requests have larger Confirm/Cancel controls.
- Booking search supports client name, phone number, service and date, with a status filter for Pending/Confirmed/Completed/Cancelled.
- Tap a client's name to open their **Client History** without exposing it publicly.
- **Add Booking** has its own uncluttered page and date picker.
- Notification controls remain under **Settings**.
- Mobile has a bottom navigation bar for Calendar, Bookings, Add and Settings.
- Activity History has its own search field.

### Completed bookings remain blocked

Confirmed **and Completed** appointments continue to reserve their original appointment range plus buffer. Only a **Cancelled** booking releases that time.

For an existing Supabase project, run `KEEP-COMPLETED-BOOKINGS-BLOCKED.sql` (or `RUN-THIS-ONCE-COMPLETED-BLOCKS.sql`) once in **Supabase → SQL Editor**. The fresh-install `supabase-setup.sql` and full `SUPABASE-UPGRADE.sql` also include this rule.


## Booking correction controls

This version adds:

- **Edit** button on booking cards, including Pending, Confirmed, Completed and Cancelled bookings.
- Edit booking date, start time, duration, buffer, service, client name, phone number and client notes.
- Existing booking is excluded from its own overlap check when editing.
- Confirmed and Completed bookings remain reserved after an edit.
- **Delete** button permanently removes a mistaken booking and releases that booking's reserved time after confirmation.
- Client phone numbers are shown as direct **WhatsApp links** in booking cards and Client History.
- South African local numbers beginning with `0` are automatically converted to `27...` for WhatsApp links.
- The mobile dashboard navigation is now **fixed directly to the bottom of the screen**.
- Extra bottom padding is reserved inside the dashboard so the final Settings/History/booking controls remain fully readable above the fixed navigation.


## Today-first layout redesign

- Dashboard now opens on **Today** instead of Calendar.
- Today includes pending requests, today's confirmed bookings and the next three upcoming appointments.
- Desktop Today view uses a two-column layout with appointments on the left and a compact calendar/quick navigation on the right.
- Mobile navigation is simplified to **Today / Calendar / Bookings / More**.
- A floating emerald **+ Add Booking** button sits above the bottom navigation on mobile.
- Mobile calendar cells are more compact to leave more space for appointments.
- Booking cards now emphasise the appointment time, client and service while keeping status compact.
- **Edit / Cancel / Delete / Client History** are grouped under a `⋯` menu so everyday cards are less cluttered.
- Pending cards keep large Confirm/Decline actions. Confirmed cards keep Complete and WhatsApp actions visible.
- Completed and cancelled history remains collapsed by default.
- Selected-day controls are tucked inside a **Manage Day** drawer; Advanced Options remains available for custom hours, leave and holidays.
- **More** groups Booking Rules, Notifications, Business Hours/Availability, Activity History and Administrator Access into expandable sections.
- Client History now includes a concise visit summary with the most recent past visit.
- Extra bottom spacing ensures the fixed mobile navigation and floating Add button never cover the final controls.


## Booking menu display fix

- The Edit / Cancel / Client History / Delete menu is now moved temporarily to the document body while open.
- This prevents the dropdown from loading behind booking cards, History sections, scroll areas, or modal content.
- The menu is anchored to the right side of the `⋯` button and automatically stays inside the phone screen.
- When there is not enough room underneath a card, it opens upward instead.
- Tapping elsewhere closes the menu.
- Mobile menu options have larger touch targets and remain above the fixed bottom navigation.


## Background push notification upgrade

This build includes true Web Push support. Register an authorised therapist phone once from More → Notifications → Enable Background Push. The subscription is saved in Supabase and intentionally remains active after logout. New Pending website booking requests can then be pushed by the included Supabase Edge Function/database webhook even while the admin app is signed out or closed.

See `PUSH-NOTIFICATION-SETUP.md` and `PUSH-NOTIFICATIONS-SETUP.sql`. Server-only secret values are delivered separately and must not be uploaded with the website.


## Simplified owner-only screen

- Removed the public Business Hours strip from the app view.
- Removed the Get In Touch section.
- Removed the static business WhatsApp number/button from the public layout.
- Kept only the website link: `massagebyash.co.za`.
- Booking/client WhatsApp links inside the therapist booking dashboard are unchanged.
