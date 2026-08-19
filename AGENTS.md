# AustinGarrod.ca Agent Guide

This repo is Austin Garrod's personal/professional portfolio site. It is a static Astro + TypeScript build for basic HostPapa/cPanel hosting, with narrowly scoped PHP endpoints copied into `dist/`.

## Read First

- `DESIGN.md` is the design source of truth. It was copied from the proper Stitch export at `C:\Users\Austin\Downloads\stitch_austin_garrod_developer_portfolio.zip`, inside `personal_site/DESIGN.md`.
- The Stitch export hash at the time this file was added was `75B88750B0F0E240BEAEC1FC5280268321EC0D46417E149E4F984BCFAC4C6DAF`.
- The copied `DESIGN.md` hash was `78694FAE07A7160A214A5A1738CFDBC13319E60D7D5C70F69FA7AD8BA5484F5B`.
- Use the "International Precision" design direction: light surfaces, strict grid, black primary actions, teal accents, sharp 0px corners, Inter, JetBrains Mono labels, 1px borders, no shadows.
- Do not revive the older dark "Kinetic Engineering" direction. That was based on stale design context.
- The Stitch HTML/screenshot exports are visual references only. Some generated copy, locations, and project examples in those files are placeholders or stale. Real site content lives in `src/data/profile.json`.

## Project Shape

- `src/pages/` contains Astro routes for Home, About, Projects, Utilities, Contact, 404, sitemap, and robots.
- `src/components/` contains reusable layout and content components.
- `src/data/profile.json` is the canonical content source for profile, navigation, skills, experience, project cards, utility cards, generated assets, and sitemap dates. `src/data/profile.ts` defines and exports its TypeScript contract.
- `src/utilities/` contains browser utility logic. Radius Map measurements are device-local and its service worker must remain scoped to `/utilities/radius-map/`.
- `src/styles/global.css` contains the visual system and responsive layout.
- `scripts/generate-assets.py` generates `public/og-image.png` and `public/austin-garrod-resume.pdf`.
- `public/contact.php` is the HostPapa/cPanel contact handler and must continue to work without Node on the server.
- `public/utilities/radius-map/api/geocode.php` is the HostPapa geocoding proxy. Preserve its submit-only search, hashed cache keys, upstream rate limit, and absence of raw-query logging.
- `dist/`, `output/`, `tmp/`, `.astro/`, and `node_modules/` are generated/local artifacts and should not be committed.

## Commands

```powershell
npm install
python -m pip install -r requirements.txt
npm run generate:assets
npm test
npm run build
npm run preview
```

Use `npm run build` as the main verification command. It runs `astro check`, `astro build`, and generates the scoped Radius Map service worker.

If PHP is available locally, also run:

```powershell
php -l public/contact.php
php -l public/utilities/radius-map/api/geocode.php
```

PHP CLI is not required for local Astro work; the contact form still needs a HostPapa-side smoke test after deployment.

## Content Rules

- Position Austin as a senior full-stack engineer, not as a consulting-heavy lead-generation brand.
- Keep private project case studies sanitized. Do not add private repo links, credentials, household details, client-sensitive details, or invented metrics.
- Do not associate Austin with Open Design; he has no role or contributions to that project.
- Do not present CAPM as currently active unless renewed after the listed April 2026 expiry.
- Avoid fake companies, fake locations, fake testimonials, fake screenshots, and fake stock imagery.

## Design Rules

- Follow `DESIGN.md` and the current implementation in `src/styles/global.css`.
- Keep corners sharp: `border-radius: 0` unless a very specific visual exception is already established.
- Prefer 1px borders and tonal surface changes over shadows.
- Keep letter spacing at `0` in implementation, even where the Stitch design export lists tracking values.
- Keep the homepage hero headline restrained. It was intentionally reduced after review; avoid increasing it back to the original oversized scale without explicit direction.
- Use lucide icons through `@lucide/astro` when an icon is needed.
- Preserve responsive behavior for desktop, mobile, and the full mobile navigation panel.
- Keep utility controls readable over their primary workspace. Radius Map uses a compact utility header and a map-first layout rather than the full portfolio header/footer.
- Do not add account, D1, OpenAI Sites, or cross-device synchronization code to Radius Map; saved measurements remain local to the browser.

## Deployment

Production is static files plus PHP. HostPapa does not build Node code.

GitHub Actions:

- `.github/workflows/ci.yml` runs build checks.
- `.github/workflows/deploy.yml` runs automatically on every push to `main`, builds `dist/`, and uploads the contents of `dist/` over explicit FTPS when all HostPapa secrets are present.
- The deploy workflow can also be run manually from GitHub Actions via `workflow_dispatch`.

Required repository secrets:

- `HOSTPAPA_FTP_HOST`
- `HOSTPAPA_FTP_USER`
- `HOSTPAPA_FTP_PASSWORD`
- `HOSTPAPA_REMOTE_DIR`

For the current HostPapa FTP user, `HOSTPAPA_REMOTE_DIR` is `./` because the login root is already `public_html`. If these secrets are absent, the deploy workflow succeeds but skips upload.

## Verification Checklist

- Run `npm run generate:assets` after changing the asset generator, resume content, or OG image.
- Run `npm run build` before committing.
- For visual changes, preview locally and check Home, About, Projects, Utilities, Radius Map, Contact, 404, and the mobile menu.
- For Radius Map changes, exercise search, coordinates, on-demand geolocation, map placement, measurement conversion, device-local CRUD, visibility, triangulation, installability, and offline-shell behavior without caching map tiles.
- Check for horizontal overflow, cramped buttons/inputs, broken links, resume download, image loading, and contact form markup.
- After HostPapa deployment, verify `https://austingarrod.ca`, HTTPS, resume download, contact form delivery, and that old content is replaced.
