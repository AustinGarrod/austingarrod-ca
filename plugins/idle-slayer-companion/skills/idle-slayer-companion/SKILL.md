---
name: idle-slayer-companion
description: Look up Idle Slayer entries, advise from synced Companion progress, and review or update that progress.
---

# Idle Slayer Companion

Use the Idle Slayer Companion MCP server for catalog lookup, synced progress, and upgrade advice. Resolve duplicate titles using their catalog IDs and system. Use recommend_upgrades for eligible options and disclose whether it used wiki priorities or the catalog cost fallback. Treat missing observations as unrecorded and quantities as decimal strings. Use the Companion's visibility rules and respect untracked progress. If there is no synced save, direct the user to the Companion's account sync setup.

Choose the typed preview_change operation for observations, goals, recipe plans, Ascension purchases and corrections, Astral activation, milestones, Ultra Ascension, named checkpoints, saved comparisons, or a recovery restore. Ask the user to select any unresolved prerequisite alternative. Show all material effects, including dependent removals, reset effects and warnings. Checkpoints are references. Recovery restores replace the selected synced document and keep a copy of its current state.

Wait for explicit confirmation after presenting the preview, then pass its ID to apply_change. On conflict or expiry, create a new preview and obtain fresh confirmation. Report the resulting revision and recovery copy. Never infer that an in-game purchase or reset occurred from a request for advice.

If the MCP server is missing or signed out, use the [assistant setup page](https://austingarrod.ca/account/assistants/) to install or reconnect. Sign in through the browser.
