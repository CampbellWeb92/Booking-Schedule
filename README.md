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
