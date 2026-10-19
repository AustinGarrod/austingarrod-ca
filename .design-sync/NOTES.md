# Claude Design sync notes

- **Styles-only (tokens-only) sync, by choice.** The site's components are Astro (`src/components/*.astro`), and design-sync only imports React components. On the first sync (2026-10-18) Austin chose to sync styles and guidelines rather than port the components to React. The project has no component cards; `window.AustinGarrod` is empty by design.
- `.design-sync/entry.mjs` is an empty module that gives the converter a bundle entry inside the repo. It must stay inside the repo with no other `package.json` between it and the root: the converter finds the package root by walking up from the entry, and `cssEntry` must be inside that root.
- `cssEntry` is `src/styles/global.css` only. `radius-map.css` and `screen-cut-calculator.css` are page-specific utility styles and are left out on purpose.
- **Fonts:** `global.css` uses site-absolute URLs (`/fonts/...`), which the converter can't resolve. `.design-sync/fonts.css` repeats the two `@font-face` rules with paths relative to itself so the woff2 files get copied into `fonts/`. The converter still writes the two broken `/fonts/...` rules into `fonts/fonts.css` before the working ones. The working rules come last and win, so this is harmless. If `global.css` changes its `@font-face` rules (weights, families), update `.design-sync/fonts.css` to match.
- React isn't a repo dependency. Install it into `.ds-sync/` along with the converter deps: `npm i esbuild ts-morph @types/react react@18.3.1 react-dom@18.3.1 playwright@1.63.0`. Pass `--node-modules .ds-sync/node_modules`.
- Playwright 1.63.0 matches the cached `chromium-1243` in `%LOCALAPPDATA%\ms-playwright`. Newer Playwright versions want a newer Chromium build that isn't installed.
- `[DTS_REACT]` warns on every build because there are no components to type. Ignore it.
- The render check covers 0 previews (there are none). Verification was a local page (`ds-bundle/.verify.html`, script at `.design-sync/.cache/verify.mjs`) that loads only `styles.css` and renders the site's classes through React. Checks: Inter and JetBrains Mono load from `fonts/`, buttons are black with 0px radius, no failed requests. Desktop and 390px mobile screenshots both looked right.

## Known render warns

- None. The render check is empty in this shape.

## Re-sync risks

- `.design-sync/conventions.md` lists class names and tokens by hand. Renaming or removing a class in `global.css` makes the header lie to the design agent. Re-validate every named class and token against `ds-bundle/_ds_bundle.css` on each sync (a grep loop over the names works).
- `.design-sync/fonts.css` duplicates the `@font-face` rules in `global.css` and can drift from them.
- `guidelines/DESIGN.md` is the Stitch export. Its token names and tracking values differ from the implemented CSS, and the conventions header tells the agent the CSS wins. If DESIGN.md is replaced, check that still holds.
- The generated README body still calls this a "React library" with 0 components. The conventions header above it corrects this.
