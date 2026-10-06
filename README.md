# AustinGarrod.ca

Personal and professional portfolio site for Austin Garrod. Built as a static Astro site for basic HostPapa/cPanel hosting, with narrowly scoped PHP endpoints copied into the production output.

## Stack

- Astro static output
- JSON content data with TypeScript validation
- CSS with the light International Precision visual direction from the proper Stitch export
- PHP contact and utility handlers for cPanel shared hosting
- GitHub Actions for CI and FTPS deployment

## Design Source

`DESIGN.md` is copied from the proper Stitch export sent for this project:

`C:\Users\Austin\Downloads\stitch_austin_garrod_developer_portfolio.zip` -> `personal_site/DESIGN.md`

The current visual system is light, precise, and Swiss/corporate: sharp corners, 1px borders, black primary actions, teal accents, Inter, JetBrains Mono labels, no shadows, and no placeholder Stitch copy. See `AGENTS.md` for implementation guidance for AI agents.

## Local Development

```powershell
npm install
python -m pip install -r requirements.txt
npm run generate:assets
npm test
npm run dev
```

Build the production site:

```powershell
npm run build:deploy
```

`build:deploy` regenerates the resume and social image, builds Astro and the Radius Map offline shell, writes `dist/deployment-manifest.json`, and runs the deployment verifier across every route and generated artifact.

Preview the built output:

```powershell
npm run preview
```

## Content

Profile and project data live in `src/data/profile.json`; `src/data/profile.ts` supplies the TypeScript contract used by Astro. The Python asset generator reads the same JSON file so site copy, the resume, social artwork, and sitemap metadata cannot drift independently. Private project material is intentionally sanitized: the public site can describe the work, stack, and engineering shape without publishing private repository URLs or sensitive household/client details.

The generated resume lives at `public/austin-garrod-resume.pdf`. Regenerate it with:

```powershell
npm run generate:assets
```

## Utilities

`/utilities/` is the catalog for focused browser tools. Utility metadata lives beside the rest of the canonical site content in `src/data/profile.json`, while each implementation lives under `src/utilities/` and receives its own public route.

Radius Map is available at `/utilities/radius-map/`. It uses Leaflet and OpenStreetMap in the browser, stores named measurements only in that browser under the versioned `austingarrod.utilities.radius-map.v1` key, and keeps its installable service worker scoped to the Radius Map route. The service worker caches the application shell but deliberately excludes PHP API requests and third-party map tiles.

Place searches use `public/utilities/radius-map/api/geocode.php`, a same-origin HostPapa proxy with submit-only search, input validation, a one-request-per-second upstream limit, and temporary hash-keyed response caching. The cache does not store raw search terms or associate searches with saved measurements.

## Contact Form

The contact page posts to `public/contact.php`, which Astro copies to `dist/contact.php`. It sends mail to `austin.r.garrod@gmail.com` with:

- honeypot spam field
- per-client rate limiting with hashed identifiers stored in the server temp directory
- required field checks
- email validation
- length limits
- header-injection protection by stripping line breaks from header fields
- an existing domain mailbox as both the visible and envelope sender for SPF/DKIM alignment
- server error logging when the local mail system does not accept a message

Local PHP CLI is optional. If PHP is installed, check syntax with:

```powershell
php -l public/contact.php
php -l public/utilities/radius-map/api/geocode.php
```

Otherwise, smoke test the form after upload on HostPapa.

## Analytics

Umami is compiled into production builds only and is additionally restricted to `austingarrod.ca` and `www.austingarrod.ca`, so local development and localhost previews cannot report traffic. The tracker respects the browser's Do Not Track preference.

Production analytics include:

- automatic pageviews, referrers, and UTM campaign parameters
- Core Web Vitals through Umami performance tracking
- session replays and click/scroll heatmaps through Umami's separate recorder
- resume views and file downloads
- project case-study views and public project/source link clicks
- major CTA, outbound profile, email, mobile menu, and 404 recovery events
- utility opens and privacy-safe Radius Map actions without search terms, coordinates, or measurement names
- valid contact-form submissions plus separate `contact-form-sent`, `contact-form-error`, and `contact-form-invalid` outcomes, without sending field values

The deployment verifier checks this configuration on every production build. Umami website settings enable replays and heatmaps at a sample rate of `1` (100% of eligible sessions), with moderate input masking, a maximum replay duration of 20 minutes per page, and the block selector `[data-analytics-private], .rr-block, iframe`. This configuration lives in Umami, not in recorder script attributes. Existing visits cannot be backfilled.

Contact fields and Radius Map locations, map tiles, saved measurements, names, and results are excluded from replay snapshots with both `data-analytics-private` and rrweb's `rr-block` class. Calculator inputs and results are excluded too. Custom utility events contain only fixed action/outcome categories; they never include input values. Heatmaps collect pixel click positions and scroll depth, including over blocked areas, but no field contents or geographic coordinates. The current utilities do not encode their local data in URLs; keep it that way because the recorder captures page URLs, including queries and fragments. Ordinary tracking retains UTM parameters and excludes URL fragments. Visitor identification remains unused.

The recorder loader applies the same production domains, browser Do Not Track preference, and `umami.disabled` local opt-out as the tracker. Embedded previews do not send pageviews, events, performance data, or recordings. The site's `frame-ancestors` policy permits only this site's origin and `https://analytics.garrod.house`, so Umami can display heatmap overlays.

Saved Umami goals track `contact-form-sent` (Contact message sent), `file-download` (Resume downloaded), and `project-case-study-view` (Project case study opened). The Contact page to sent message funnel follows `/contact/` → `contact-form-submit` → `contact-form-sent` within 60 minutes. These reports are scoped to Austin Garrod's website and retain existing event names.

## GitHub Actions Deployment

CI runs on every push and pull request. Deployment runs automatically on every push to `main`: GitHub Actions installs dependencies, regenerates assets, builds `dist/`, and uploads the contents of `dist/` to HostPapa over explicit FTPS.

The deploy workflow can also be started manually from the GitHub Actions tab via `workflow_dispatch`.

Required repository secrets:

- `HOSTPAPA_FTP_HOST`
- `HOSTPAPA_FTP_USER`
- `HOSTPAPA_FTP_PASSWORD`
- `HOSTPAPA_REMOTE_DIR`

For the current HostPapa FTP user, `HOSTPAPA_REMOTE_DIR` is `./` because the account lands directly in `public_html`. If the FTP user changes later, confirm the login directory before changing this value.

The deployment uploads the contents of `dist/`, including static pages, scoped `.htaccess` files, PHP endpoints, the resume PDF, utility PWA assets, generated images, and `deployment-manifest.json`. The manifest records the exact Git commit plus the SHA-256 hash and byte size of every other deployed file. After deployment, compare the public manifest at `https://austingarrod.ca/deployment-manifest.json` with the workflow commit and public asset hashes. If a deploy needs to be rolled back, rerun the workflow for an earlier commit or manually upload the previous `dist/` package through cPanel File Manager.

## HostPapa Notes

This project avoids server-side Node in production. HostPapa only needs to serve static files and execute PHP for the contact form. If cPanel Git deployment is used later, keep the Git checkout separate from `public_html` and deploy only the built files.

`public/.htaccess` defines canonical HTTPS/apex redirects, HSTS, security headers, the custom 404, asset caching, and the web-manifest MIME type. HostPapa places nginx in front of the document root on some plans, so `.htaccess` alone is not proof that redirects or headers are active. After each deployment, verify the public response and configure the equivalent canonical redirect in cPanel or through HostPapa support if nginx serves the request before Apache.

Post-deploy checks should confirm:

- `http://austingarrod.ca/` redirects permanently to `https://austingarrod.ca/`
- `https://www.austingarrod.ca/` redirects permanently to the HTTPS apex
- explicit `index.html` URLs redirect to their trailing-slash routes
- HTTPS responses include HSTS and the expected security headers
- the resume has a one-hour revalidation cache, not a one-month immutable cache
- the contact form reaches the expected mailbox
