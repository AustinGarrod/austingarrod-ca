# Idle Slayer Companion — site utility design

## Source of truth

The companion is a focused utility on AustinGarrod.ca. Follow the parent `../../DESIGN.md` International Precision system and the site's implemented palette. This replaces the former cocoa, gold, magenta, and pixel-heading treatment. Game catalog facts, artwork, node bounds, and rule evaluation remain unchanged.

## Visual system

- Use locally bundled Inter for headings, controls, and prose. Use JetBrains Mono for compact labels, table headings, status badges, and numerical metadata. Letter spacing stays zero.
- Use the cool light canvas `#f8f9ff`, white surfaces, and `#eff4ff` tonal groups. Ink text is `#0b1c30`, secondary text `#45464d`, and borders `#c6c6cd` with darker control boundaries where needed.
- Primary actions use black with white text. Teal `#006a61` identifies active navigation, links, completed progress, and keyboard focus. Error states use `#b42318` with explicit wording.
- Keep corners at 0px and structural borders at 1px. Do not add shadows, decorative gradients, or letter tracking. Selection and focus outlines may exceed 1px so they remain distinguishable.
- Preserve native game icon bytes and crisp pixel rendering. The original application journal/compass installation mark uses the site palette; it is separate from game artwork.

## Companion shell and modules

The header is the site's slim utility header, reproduced in `CompanionShell.css` because this is a separate build: the "Austin Garrod" brand linking home, the breadcrumb `Utilities / ✦ Idle Slayer Companion` (Utilities returns to the portfolio's utility list; the last part returns to Overview), and a right-hand note with a short save state, "Unofficial" and one black **Data** button. It has a solid canvas background and a 1px bottom border, 64px tall and 56px under 760px, where it keeps Menu, the brand (from 375px), "‹ Utilities", a save-state square and Data. The website build links root-relatively; the legacy-migration build links to absolute `https://austingarrod.ca/` addresses. The header carries no tracker attributes because the portfolio's tracker never loads here. Data opens one Data & backup screen: Import save, Back up everything, one Restore that recognises every file the app writes, QR transfer (Ascension map progress and layout only), Account (website build only), Clear, and Advanced single-file exports with their original labels.

A desktop section rail becomes the existing keyboard-trapped modal menu below 900px; its collapsed state is a device-local preference. On phones, outside the map, the status row appears only when there is something to act on (Undo, Redo, a result or recovery), so the first screen is the 56px header and the page. On the map it stays a fixed compact row so the canvas does not resize; on short phones (at most 600 × 650px) it is hidden unless it carries a result or recovery, and Undo/Redo move into the Record tools. Change confirmations are a status message in that row, not a toast, with Undo briefly highlighted. The seven sections stay Overview, Ascension, Achievements, Crafting & materials, Quests & Village, Bestiary, and Divinities.

Overview organizes tracked systems, goals, and shopping lists. Tracker sections are dense lists, grouped by category under sticky headings with "X of Y" counts. Each entry is one 56px row (native icon, name, a one-line description, the fact it records as a two-button toggle, an inline count where that is the point, and the goal star); on phones the toggle takes a second line and counts move into the expanded entry. A row expands in place into the full entry: description, every control, recipe, mastery tiers, related links and sources. Long sections start with their groups closed so the category list itself is the overview; a search or filter opens the matching groups. Rows use `content-visibility: auto` instead of paging. Entries keep native icons, explicit observations, and honest unrecorded/unknown states. Spoiler visibility governs cards, details, searches, summaries, goals, and previews together. Styling must not expose hidden content or turn estimates into recorded facts.

The migration guide appears before the workspace in a capped, scrollable notice area. Website instructions are collapsed. The legacy recovery release includes a prominent moved notice and explicit new-utility link. The notice must leave useful map space on short screens.

## Map presentation

Game Layout preserves every extracted native center with only the established screen Y reflection. Its nodes retain 100×100 bounds and 64×64 icon artwork. Detailed Layout keeps the existing visible-only layered arrangement, 132×122 card bounds, routed corridors, and camera behavior. Both layouts use square surfaces. The existing native line endpoints remain behind opaque node surfaces, preserving routing geometry.

Purchased nodes use a teal border and check; available nodes use an ink border and an inverted black badge with a white plus, so they stand out without spending another colour; pending nodes use a slate dashed border and clock; locked nodes use muted dashed borders, a diamond and dimmed artwork. The map summary is two short lines: owned, available and Ultra Ascension counts, then a four-symbol legend with the line meaning. Accessible labels and visible symbols communicate state independently of color. No state implies Slayer Point affordability.

Selection uses a black node outline. Keyboard focus uses a separate teal outer outline. Incident incoming paths use teal dashes and outgoing paths use ink arrowheads; ordinary paths are slate. The native map keeps its reviewed line thickness and center vectors. Connection emphasis never changes dependency or activation rules.

Game titles remain available on hover and focus; complete titles, requirements, and effects remain in the inspector. The inspector reads in one order: state, cost and the primary action (Record purchase, Already activated, or a quieter Remove purchase text action), then the description, requirements with one shared footnote, Leads to, Connected from, retention, and collapsed Sources. Per-upgrade tools sit in two small menus: **Plan with this upgrade** (goal, comparisons, routes, hypothetical UAs, forward impact) and **Share this upgrade** (reference link, exact SP value and native ID, reference sheet). Large costs retain coefficient/power notation and exact accessible values. All graph interactions preserve native coordinates and fixed, non-draggable nodes.

## Responsive and accessible behavior

Retain at least 44px control hit targets. Reflow narrow and enlarged-text layouts without shrinking essential labels. Check 320px phones, short landscape screens, and 200% zoom. Module headings may wrap; search, panels, notices, and dialogs scroll independently without horizontal page overflow.

The map stays mounted when changing sections so visit-only tools retain their existing behavior. Its toolbar is one row on desktop: search, Next upgrade, the layout switch and three tools grouped by intent, **View** (a popover), **Plan** and **Record** (menus built in `MenuButton.tsx`, no dependency). Under 760px of map width search takes the full first row, the layout switch moves into View and tool popups open from the right edge of the tools row (its full width on narrow phones), so none opens off-screen; at ordinary text sizes the tools stay on one row down to 320px. The toolbar, camera controls, inspector insets and toast placement (inside the map, above the camera bar) preserve useful canvas space. Selection centering follows actual available geometry, not a hardcoded screenshot size.

Keep the single graph Tab stop, ordered arrow/Home/End navigation, camera shortcut, focus visibility, reduced motion, forced-colors handling, dialog focus trapping, Escape, and return-to-opener behavior. Navigation and dialogs must not obscure the selected upgrade or strand keyboard focus.

## Progress, references, and privacy

Styling does not change progress formats, guards, recovery, Undo/Redo, or import confirmation. Goals and recipe plans remain separate from actual recorded progress. Checkpoints and saved comparisons remain bounded reference documents with their own exports; comparison visibility is intentionally limited to the current revealed universe.

All existing private replay exclusions remain in place. Never load the portfolio's tracker on this document: the companion's own startup handles private transfer fragments, its opt-out, and its reviewed analytics/reporting adapters. The legacy migration build sends no telemetry.

The production output remains static, includes complete notices and self-hosted fonts, and owns a service worker limited to its route. Neither the portfolio nor Radius Map worker scope is widened.
