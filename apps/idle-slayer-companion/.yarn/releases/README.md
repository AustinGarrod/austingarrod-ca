# Repository Yarn release

This project carries the official Yarn 4.13.0 CLI so normal `yarn` commands select the pinned version through `.yarnrc.yml`'s `yarnPath`. It works with the installed Yarn Classic 1.22.22 launcher on Windows and does not require a Corepack command or a global Yarn upgrade.

Without a global launcher, use `node .yarn/releases/yarn-4.13.0.cjs <command>`. CI invokes this file directly. Node.js 24 and the `node-modules` linker remain required.

- Official distribution: https://repo.yarnpkg.com/4.13.0/packages/yarnpkg-cli/bin/yarn.js
- SHA-256: `730e0619753d39754c9e7613c7e57f084ea18b3244f5ba9a5a60bd3da048450b`
- Upstream license: https://github.com/yarnpkg/berry/blob/%40yarnpkg/cli/4.13.0/LICENSE.md
- Local license: [LICENSE.yarn.txt](LICENSE.yarn.txt), BSD 2-Clause, Yarn Contributors.

The CLI is development tooling and is not included in the deployed website. Keep generated `.yarn` caches/install state ignored. Review and update the version, distribution hash, license and CI commands together when upgrading Yarn.
