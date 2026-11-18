---
name: pokedex-binder
description: Find Pokémon and card printings, review a synced collection, or update owned National Dex entries and named set binders.
---

# Pokédex Binder

Use the Pokédex Binder MCP server when the user asks about their collection or about English physical card printings. Resolve species by National Dex ID. Use set IDs from the catalog and keep collector numbers as strings, including leading zeroes. For collection questions, read the synced collection with the requested set, ownership and search filters. Use the printing list for exact card names and collector numbers. If the account has no synced Binder, direct the user to the Binder's account sync setup.

For master sets, use list_set_binders to resolve the named binder. Ask which copy the collector means if more than one matches. Use get_set_binder for required and optional progress, exact printing keys and pocket locations. For a set edit, preview set_slot_ownership with the binder ID and the exact key, show the binder, number and finish, and wait for explicit confirmation before applying.

For National Dex ownership edits, resolve ambiguous species first. Preview a set_ownership operation with the exact National Dex IDs and requested ownership. Present the changes and wait for explicit confirmation before applying the returned preview ID. For a recovery restore, list recovery copies, identify the selected revision, and preview the restore before requesting confirmation. If the preview expires or the save changes, request a fresh preview and confirmation. Report the confirmed revision and recovery copy from the apply receipt.

If the MCP server is missing or signed out, use the [assistant setup page](https://austingarrod.ca/account/assistants/) to install or reconnect. Sign in through the browser.
