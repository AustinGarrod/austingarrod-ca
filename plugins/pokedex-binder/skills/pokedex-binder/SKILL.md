---
name: pokedex-binder
description: Find Pokémon and card printings, review a synced collection, or update card status in the National Dex and named set binders.
---

# Pokémon Binder Tracker

Use the Pokémon Binder Tracker MCP server when the user asks about their collection or about English physical card printings. Resolve species by National Dex ID. Use set IDs from the catalog and keep collector numbers as strings, including leading zeroes. For collection questions, read the synced collection with the requested set, ownership and search filters. Use the printing list for exact card names and collector numbers. If the account has no synced Binder, direct the user to the Binder's account sync setup.

For master sets, use list_set_binders to resolve the named binder. Ask which copy the collector means if more than one matches. Use get_set_binder for required and optional progress, exact printing keys and pocket locations. Both get_set_binder and get_collection accept the status filters all, missing, ordered, and owned. Missing excludes cards already ordered. For a set edit, preview set_slot_status with the binder ID, exact key, and status (missing, ordered, or owned). Show the binder, number, finish, and new status, and wait for explicit confirmation before applying.

For National Dex status edits, resolve ambiguous species first. Preview a set_status operation with the exact National Dex IDs and requested status (missing, ordered, or owned). Present the changes and wait for explicit confirmation before applying the returned preview ID. For a recovery restore, list recovery copies, identify the selected revision, and preview the restore before requesting confirmation. If the preview expires or the save changes, request a fresh preview and confirmation. Report the confirmed revision and recovery copy from the apply receipt.

If the MCP server is missing or signed out, use the [assistant setup page](https://austingarrod.ca/account/assistants/) to install or reconnect. Sign in through the browser.
