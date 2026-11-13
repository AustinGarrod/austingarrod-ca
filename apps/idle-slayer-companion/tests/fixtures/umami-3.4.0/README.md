# Official Umami 3.4.0 browser test fixtures

`script.js` and `recorder.js` are unmodified builds of the official source at
`ec0ff50388c264ed8ce46f00967e92f7e71476ae` (`v3.4.0`). The tests check their
SHA-256 hashes against `provenance.json`. The recorder contains the real rrweb
2.0.1 DOM serializer, not a recording mock.

These files are **test-only software**. They are outside `public/`, never imported
by application code and never bundled into `dist/`. Browser tests fulfill all
configuration and upload requests locally with a synthetic website UUID. They
never contact the user's analytics instance or published site.

The analytics browser suite builds two test entries entirely in memory. A small
controller harness verifies loader gates and preference behavior. An application
variant aliases application analytics imports to a test adapter that uses the
same controller with a localhost origin and synthetic UUID. That variant checks
the actual UI handlers and DOM recordings; it never changes production build
settings or adds a runtime test switch. Normal localhost previews remain untracked.

The fixtures were built using Node.js 24, the repository's Yarn 4.13.0 release,
the official Rollup configurations and the build versions recorded in
`provenance.json`. rrweb and its dependencies follow the official release lock.
`LICENSES.txt` contains the Umami, rrweb and embedded dependency notices.

To reproduce the pinned fixtures from official source on Windows:

```powershell
node tests/fixtures/umami-3.4.0/rebuild.mjs
```

The script builds in a fresh directory under the system temporary directory,
verifies source and output hashes, and leaves that directory for inspection.
It does not change the repository's packages, lockfile or fixtures. A changed
hash requires review rather than automatically replacing this proof fixture.
