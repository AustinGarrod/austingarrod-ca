# Maintaining bundled software notices

The reviewed inventory is `public/licenses/notices.json`. It covers the actual
browser runtime, CSS and font packages, Graphlib embedded in Dagre, and generated
Vite/Rolldown helpers. Package versions, license identifiers, inclusion kinds and
notice source/destination filenames are **human-reviewed inputs**. Complete
upstream notice bytes, their SHA-256 hashes and `index.html` are mechanical outputs.
The tools do not determine whether a license is acceptable or discover every
embedded third-party component.

Run commands from the repository root with Node.js 24 and the pinned Yarn 4.13.0:

```powershell
yarn install --immutable
yarn notices:check
```

`notices:check` reads without writing. It verifies reviewed metadata against
installed packages, complete source/copy bytes, hashes and the generated index;
it also reports unreferenced notice copies. Bundle coverage needs `yarn build`,
and distributed notice/code receipt checks need `yarn check:release` after that
build. A source notice check alone does not establish actual bundle coverage.

Without a global Yarn launcher, the same commands work as:

```powershell
node .yarn/releases/yarn-4.13.0.cjs install --immutable
node .yarn/releases/yarn-4.13.0.cjs notices:check
node .yarn/releases/yarn-4.13.0.cjs notices:refresh
```

## Review and refresh after an authorized dependency change

1. Review the dependency change and committed lockfile using the normal project
   process, then run `yarn install --immutable` so `node_modules` matches it. Notice
   maintenance itself does not upgrade or install packages.
2. Inspect the affected installed `package.json` files and **read their complete
   upstream license and additional notice files**. Compare them with the existing
   copies and review version/license changes, copyright/attribution requirements,
   new bundled dependencies, removals and inclusion changes. A matching license
   identifier alone does not establish unchanged obligations.
3. Edit the affected reviewed entries in `public/licenses/notices.json` explicitly:
   `name`, installed `version`, installed `license`, `inclusion` and every required
   notice's `source`/`file`. Leave old hashes for refresh to replace; for a new
   notice use `"sha256": ""` as a temporary placeholder. Keep existing order and
   insert new identities in name order for a readable diff. Preserve every
   complete required notice, including additional third-party texts.
4. For a removed package or renamed copy, remove its entry and review each now
   obsolete `.txt` file before deleting it from `public/licenses`. The tool reports
   unreferenced filenames and refuses both check and refresh until this review is
   resolved; it does not delete files or remove inventory entries automatically.
   Destination identities are case-insensitively unique. A case-only rename must
   also match the actual directory entry before either command proceeds; explicitly
   rename the reviewed copy through a temporary filename on Windows (for example,
   `git mv public/licenses/old.txt public/licenses/notice-rename.tmp`, then
   `git mv public/licenses/notice-rename.tmp public/licenses/Old.txt`). Review both
   paths first. The tool never silently approves or performs file renames.
5. Regenerate and inspect the mechanical changes:

   ```powershell
   yarn notices:refresh
   yarn notices:check
   git diff -- public/licenses
   git status --short
   ```

   Refresh refuses version/license mismatches and invalid identities/paths; it
   never fills those fields from installed metadata. It preflights all sources
   before writing, copies their bytes without trimming or newline conversion,
   computes SHA-256, writes the manifest and regenerates the shared index. A
   second refresh produces identical bytes and reports `0 files changed`. If a
   filesystem write fails, resolve the failure and rerun refresh and check before
   building. A refresh is a mechanical operation, **not license approval**.
6. Verify the actual build and distributable locally:

   ```powershell
   yarn test:tools
   yarn typecheck
   yarn test
   yarn build
   yarn check:release
   ```

   Build coverage errors name unreviewed packages, packages no longer bundled and
   changed inclusion kinds. Investigate those changes and repeat review/refresh;
   do not delete or guess entries simply to make a check pass. The generated
   `dist/licenses/bundle-notices.json` binds the final manifest, package inventory
   and emitted JavaScript hashes; never hand-edit or commit that build output.
7. Review and commit the complete final diff, including new notice files, removed
   obsolete files, the manifest/index, any reviewed coverage rules/tests and the
   authorized dependency/lockfile changes. Preserve the byte-exact `.txt`
   attributes in `.gitattributes`. Publishing is a separate authorized action.

## Additions, embedded dependencies and helpers

A normal package entry has this shape (substitute the **reviewed actual** identity,
version, license and filenames):

```json
{
  "name": "example-runtime",
  "version": "1.2.3",
  "license": "MIT",
  "inclusion": "module",
  "notices": [
    { "source": "LICENSE", "file": "example-runtime-MIT.txt", "sha256": "" }
  ]
}
```

Use `module` for packages appearing in the build module graph, including CSS/fonts
and transitive runtime dependencies. This inventory is not a list of all installed
development dependencies. Destination filenames must be unique plain `.txt`
basenames. Current source basenames are `LICENSE`, `LICENSE.md` and
`THIRD-PARTY-LICENSE`; a package with another required filename needs explicit
reviewed support in both `scripts/runtime-notices.ts` and the maintenance CLI,
plus regression coverage. Never substitute a summary or omit an upstream notice
to fit the allowlist. Keep multiple source files as separate entries, as Rolldown
does for its additional third-party notices.

Use `embedded` when distributable package code contains another component that
does not appear separately in the module graph. For the existing Dagre/Graphlib
case, review Dagre's shipped sourcemap and embedded Graphlib version, the installed
Graphlib metadata and its complete license. `validateBundleCoverage` checks that
the embedded version matches the reviewed manifest. A different embedded
component needs explicit host/version evidence and a coverage rule, accurate
index labeling and a regression test; adding a manifest entry alone cannot pass
coverage. A bundled upstream notice can list tooling dependencies without making
all those dependencies individual application runtime identities.

Use `helper` only for build-generated code emitted into the browser application.
The current mapping in `scripts/runtime-notices.ts` covers
`\0vite/modulepreload-polyfill.js` and `\0rolldown/runtime.js`. Unknown rendered
virtual modules fail the build with their module ID. Review the code's owning
package and license obligations, add an explicit mapping and test for a newly
reviewed helper, and include all required complete package notices. Do not bypass
unknown-helper rejection or treat every build dependency as a runtime helper.

The synthetic CLI regressions in `tests/tooling/runtime-notices.test.mjs` run
through `yarn test:tools`, without network access or game inputs. Existing unit,
build and release checks continue to reject stale installed versions/licenses,
incomplete bytes, wrong hashes/indexes, unreviewed bundle identities/helpers and
stale distributed coverage receipts.
