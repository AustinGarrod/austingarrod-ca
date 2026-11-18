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

The compact top bar keeps identity, save import, and backup actions reachable. A desktop section rail becomes the existing keyboard-trapped modal menu below 900px. Home and Utilities links return to the portfolio. The seven sections stay Overview, Ascension, Achievements, Crafting & materials, Quests & Village, Bestiary, and Divinities.

Overview organizes tracked systems, goals, and shopping lists. Module cards use native icons, readable headings, explicit observations, and honest unrecorded/unknown states. Spoiler visibility governs cards, details, searches, summaries, goals, and previews together. Styling must not expose hidden content or turn estimates into recorded facts.

The migration guide appears before the workspace in a capped, scrollable notice area. Website instructions are collapsed. The legacy recovery release includes a prominent moved notice and explicit new-utility link. The notice must leave useful map space on short screens.

## Map presentation

Game Layout preserves every extracted native center with only the established screen Y reflection. Its nodes retain 100×100 bounds and 64×64 icon artwork. Detailed Layout keeps the existing visible-only layered arrangement, 132×122 card bounds, routed corridors, and camera behavior. Both layouts use square surfaces. The existing native line endpoints remain behind opaque node surfaces, preserving routing geometry.

Purchased nodes use a teal border and check; available nodes use an ink border and plus; pending nodes use a slate dashed border and clock; locked nodes use muted dashed borders and diamond. Accessible labels and visible symbols communicate state independently of color. No state implies Slayer Point affordability.

Selection uses a black node outline. Keyboard focus uses a separate teal outer outline. Incident incoming paths use teal dashes and outgoing paths use ink arrowheads; ordinary paths are slate. The native map keeps its reviewed line thickness and center vectors. Connection emphasis never changes dependency or activation rules.

Game titles remain available on hover and focus; complete titles, exact SP values, native IDs, requirements, and effects remain in the inspector. Large costs retain coefficient/power notation and exact accessible values. All graph interactions preserve native coordinates and fixed, non-draggable nodes.

## Responsive and accessible behavior

Retain at least 44px control hit targets. Reflow narrow and enlarged-text layouts without shrinking essential labels. Check 320px phones, short landscape screens, and 200% zoom. Module headings may wrap; search, panels, notices, and dialogs scroll independently without horizontal page overflow.

The map stays mounted when changing sections so visit-only tools retain their existing behavior. Its compact toolbar, search, camera controls, inspector insets, and mobile options preserve useful canvas space. Selection centering follows actual available geometry, not a hardcoded screenshot size.

Keep the single graph Tab stop, ordered arrow/Home/End navigation, camera shortcut, focus visibility, reduced motion, forced-colors handling, dialog focus trapping, Escape, and return-to-opener behavior. Navigation and dialogs must not obscure the selected upgrade or strand keyboard focus.

## Progress, references, and privacy

Styling does not change progress formats, guards, recovery, Undo/Redo, or import confirmation. Goals and recipe plans remain separate from actual recorded progress. Checkpoints and saved comparisons remain bounded reference documents with their own exports; comparison visibility is intentionally limited to the current revealed universe.

All existing private replay exclusions remain in place. Never load the portfolio's tracker on this document: the companion's own startup handles private transfer fragments, its opt-out, and its reviewed analytics/reporting adapters. The legacy migration build sends no telemetry.

The production output remains static, includes complete notices and self-hosted fonts, and owns a service worker limited to its route. Neither the portfolio nor Radius Map worker scope is widened.
