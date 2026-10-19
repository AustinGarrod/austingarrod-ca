# Austin Garrod Portfolio — "International Precision" (styles-only)

**There are no React components in this design system.** The source site is Astro, so nothing exists under `window.AustinGarrod`. Build with plain JSX elements (`div`, `section`, `article`, `a`, `button`, `input`) and the site's real CSS classes and tokens from `styles.css`. Do not invent class names: if a class isn't listed here or in `_ds_bundle.css`, use inline styles built from the `var(--*)` tokens below.

## Setup

- Link `styles.css` once. It pulls in `fonts/fonts.css` (Inter 400–800, JetBrains Mono 500–700) and `_ds_bundle.css` (tokens and every class). No provider or wrapper is needed.
- The stylesheet styles `body`, `a`, `label`, `input` and `textarea` globally: light `--bg` page, ink text, links that inherit color with no underline.
- Constrain page content with `.container` (max 1440px, 64px side gutters, 16px under 760px). Breakpoints are 1100px and 760px; under 760px grids stack to one column and `.button` goes full width.

## Rules that define the look

- Light surfaces only. Primary actions are black (`--primary`), teal (`--secondary`) is for eyebrows, meta labels, links in footers and hover states, never for large fills.
- Corners are always 0. Never use `border-radius` or `box-shadow`. Separate with 1px `var(--line)` borders and tonal surface steps.
- `letter-spacing: 0` everywhere, including uppercase labels. (DESIGN.md lists tracking values. Ignore them.)
- Type: Inter 800 for headings (line-height ~1.0–1.1), Inter for body text, JetBrains Mono 700 uppercase at ~0.78rem for labels, eyebrows, tags and meta.
- Icons: Lucide outline icons at 15–18px inline or 28px in card headings, colored `--secondary` in lists.

## Tokens (`var(--name)`)

| Role | Tokens |
|---|---|
| Page / surfaces | `--bg`, `--surface` (white cards), `--surface-low`, `--surface-mid`, `--surface-high`, `--surface-highest` |
| Text | `--ink`/`--text` (headings, body), `--muted` (paragraphs), `--subtle` (captions) |
| Lines | `--line` (1px dividers), `--control-line` (input borders), `--line-strong` (secondary button, hero rules) |
| Brand | `--primary` #000, `--primary-container` (dark CTA band), `--secondary` teal #006a61, `--accent` focus ring, `--danger` |
| Layout | `--container`, `--radius-*` (all 0) |

DESIGN.md's Stitch token names (`surface-container-low` and similar) are design references only. Use the CSS variables above.

## Class vocabulary

| Family | Classes |
|---|---|
| Sections | `.content-section` (+`.tight`), `.section-band` (tinted strip), `.page-hero` (+`.page-hero-compact`) > `.page-hero-inner`, `.cta-band` > `.cta-inner` (dark, white text) |
| Headings | `.eyebrow` (teal mono kicker above a heading), `.section-heading` (+`.split` for a heading with an action on the right) containing `h2` and `p` |
| Actions | `.button.primary`, `.button.secondary`, `.button-row`, `.text-link`. `.button.compact` is the header's icon + `<span>` label button; under 760px it collapses to icon-only, so don't use it for text-only actions |
| Tags | `.tag-list` with plain `<span>` children (mono chips) |
| Grids | `.project-grid`, `.skills-grid` > `.skill-panel`, `.metrics-grid` > `.metric` (`strong` + `span` + `p`), `.two-column`, `.utilities-grid`, `.field-grid` |
| Cards | `.project-card` (+`.featured`) > `.project-visual` + `.project-content` (`.project-meta`, `h3`, `.project-label`, `p`, `.project-card-highlights`, `.tag-list`, `.project-actions`); `.utility-card` (`.utility-card-heading`, `.eyebrow`, `h2`, `p`, `ul`, `.tag-list`, `.button.primary.utility-launch`) |
| Timeline | `.timeline` > `.timeline-item` > `.timeline-meta` (`span`, `small`) + `.timeline-node` + `.timeline-content` (`.eyebrow`, `h3`, `p`, `ul > li > svg + span`) |
| Forms | `.contact-form` > `.form-note`, `.field-grid`, `label > span + input/textarea`, `.button.primary` |
| Chrome | `.site-header` > `.nav-shell` (`.brand`, `.desktop-nav` > `.nav-link`/`.nav-link.active`, `.nav-actions`); `.site-footer` > `.footer-inner` (`.footer-kicker`, `.footer-copy`, `.footer-links`) |
| Utility | `.sr-only` |

## Where the truth lives

- `_ds_bundle.css` is the site's full `global.css`. Read it before styling anything not covered above.
- `guidelines/DESIGN.md` is the design direction (strict grid, sharp corners, no shadows). Where it disagrees with the CSS (tracking, token names), the CSS wins.

## Example

```jsx
<section className="content-section">
  <div className="container">
    <div className="section-heading split">
      <div>
        <p className="eyebrow">Selected work</p>
        <h2>Projects</h2>
      </div>
      <a className="button secondary" href="/projects">All projects</a>
    </div>
    <div className="project-grid">
      <article className="project-card">
        <div className="project-visual" />
        <div className="project-content">
          <div className="project-meta"><span>Public</span></div>
          <h3><a href="#">AustinGarrod.ca</a></h3>
          <p className="project-label">Static portfolio and deployment system</p>
          <p>A static Astro portfolio built for shared hosting.</p>
          <div className="tag-list"><span>Astro</span><span>TypeScript</span></div>
          <div className="project-actions"><a className="text-link" href="#">View case study</a></div>
        </div>
      </article>
    </div>
  </div>
</section>
```
