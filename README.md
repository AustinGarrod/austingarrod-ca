# AustinGarrod.ca

Personal and professional portfolio site for Austin Garrod. Built as a static Astro site for basic HostPapa/cPanel hosting, with one PHP contact endpoint copied into the production output.

## Stack

- Astro static output
- TypeScript content/data files
- CSS with the dark Kinetic Engineering visual direction from Stitch
- PHP contact handler for cPanel shared hosting
- GitHub Actions for CI and FTPS deployment

## Local Development

```powershell
npm install
python -m pip install -r requirements.txt
npm run generate:assets
npm run dev
```

Build the production site:

```powershell
npm run build
```

Preview the built output:

```powershell
npm run preview
```

## Content

Profile and project data live in `src/data/profile.ts`. Private project material is intentionally sanitized: the public site can describe the work, stack, and engineering shape without publishing private repository URLs or sensitive household/client details.

The generated resume lives at `public/austin-garrod-resume.pdf`. Regenerate it with:

```powershell
npm run generate:assets
```

## Contact Form

The contact page posts to `public/contact.php`, which Astro copies to `dist/contact.php`. It sends mail to `austin.r.garrod@gmail.com` with:

- honeypot spam field
- required field checks
- email validation
- length limits
- header-injection protection by stripping line breaks from header fields

Local PHP CLI is optional. If PHP is installed, check syntax with:

```powershell
php -l public/contact.php
```

Otherwise, smoke test the form after upload on HostPapa.

## GitHub Actions Deployment

CI runs on every push and pull request. Deployment runs on pushes to `main` after the build passes.

Create these repository secrets before relying on deploy:

- `HOSTPAPA_FTP_HOST`
- `HOSTPAPA_FTP_USER`
- `HOSTPAPA_FTP_PASSWORD`
- `HOSTPAPA_REMOTE_DIR`

`HOSTPAPA_REMOTE_DIR` is usually something like `/public_html/`, but confirm the exact path in HostPapa/cPanel.

The deployment uploads the contents of `dist/`, including static pages, `.htaccess`, `contact.php`, the resume PDF, and generated images. If a deploy needs to be rolled back, rerun the workflow for an earlier commit or manually upload the previous `dist/` package through cPanel File Manager.

## HostPapa Notes

This project avoids server-side Node in production. HostPapa only needs to serve static files and execute PHP for the contact form. If cPanel Git deployment is used later, keep the Git checkout separate from `public_html` and deploy only the built files.
