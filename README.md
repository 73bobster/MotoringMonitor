# FleetMonitor app (flat layout)

Every file sits in one folder, so it uploads to GitHub with no folders to drag. Keep `index.html` at the root of the site.

## What it does

- **Dashboard** (opens first; the logo returns to it): fleet status and what needs attention, a stacked bar chart of vehicles available and unavailable by day, week or month (vans and HGVs in different colours), and, for a reporting period you can change (default last 30 days), accidents, damage and fines, garage downtime and a summary of drivers by points, accidents and damage
- **Tasks:** everything coming due, filterable by type and status, from compliance dates, insurance renewals, convictions, fines, accidents, lease ends, vehicles with no cover, garage bookings, vehicles overdue back from the garage, and SORN
- **Vehicles:** list, add, edit, dispose of, archive and restore; compliance, drivers, insurance cover, availability, incidents, costs, documents, mileage and history tabs
- **Availability:** garage visits (booked, current, finished) with the garage validated against the Garages list, and long-term off the road with a SORN
- **Garages:** the master list with contact name, email, phone and types of work, plus a built-in Unknown garage
- **Drivers:** work and personal phones, licence details, points and convictions, employment periods with leave and rehire, incidents, documents, history
- **Incidents:** accidents, damage and fines in one register, with costs and deadlines
- **Insurance:** policies, vehicles covered, claims, documents
- **Reports:** vehicle damage (including accident damage), accidents, vehicle mileage, vehicle status; any period; download as Excel or PDF
- **Settings** (superuser): depots. **Audit log** (fleet admins and superuser): searchable by period, vehicle and driver
- **Documents:** upload from files, a folder, the phone camera, a webcam, or drag and drop

## Files

- `index.html`: the page. `config.js`: Supabase URL, public key and the sign-in screen branding.
- `main.js`, `api.js`, `ui.js`, `actions.js`, `docs.js`, `exports.js`, `auth.js`, `shell.js`, `router.js`, `state.js`, `domain.js`: the app. `exports.js` builds the Excel and PDF files with no outside library.
- `dashboard.js`, `availability-chart.js`, `reports.js`, `insight.js`, `tasks.js`, `vehicles.js`, `availability.js`, `garages.js`, `drivers.js`, `incidents.js`, `insurance.js`, `settings.js`, `audit.js`, `history.js`, `placeholder.js`: one file per screen or shared screen logic.
- `theme.css`, `app.css`: styles. `supabase.js`: the Supabase client library (version 2.117.2). `*.woff2`: fonts (Cascadia Code and Barlow Condensed, both open licence).

## Branding

The look follows alchemydrinks.co.uk: pink banner titles (#FF0066), dark ink buttons (#2E2E2E), gold accent (#A8895B), Cascadia Code type.
- After sign-in, colours and the logo come from the organisation's `brand` setting in the database (`colours.primary`, `colours.accent`, `logo_url`).
- The sign-in screen uses `brand` in `config.js`.
- The logo is currently loaded straight from alchemydrinks.co.uk. To host it yourself, save the logo in this folder as `logo.png`, set `logoUrl: 'logo.png'` in `config.js`, and set `logo_url` to `logo.png` in the database.

## Notes

- The app is built to fit a phone screen without sideways scrolling (checked at 320 to 412 px wide).

- Serve it locally with `python3 -m http.server 8000` (ES modules need a web server).
- After deploying, set the Supabase Site URL and Redirect URLs (Authentication, URL Configuration) to the deployed address.
- Documents are stored in a private bucket. Photos and PDFs only, up to 10 MB each. Large photos are shrunk before upload.
- The offence-code list (SP30, TS10 and so on) is a convenience: check it against current DVLA guidance.
