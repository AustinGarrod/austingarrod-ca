import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
MANIFEST_PATH = DIST / "deployment-manifest.json"


def git_output(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if not DIST.is_dir():
    raise SystemExit("dist/ does not exist; run the Astro build first.")

commit = os.environ.get("GITHUB_SHA", "").strip() or git_output("rev-parse", "HEAD")
if not re.fullmatch(r"[0-9a-fA-F]{40}", commit):
    raise SystemExit(f"Invalid deployment commit: {commit!r}")
commit = commit.lower()

with (ROOT / "package.json").open(encoding="utf-8") as handle:
    package_version = json.load(handle)["version"]

files = {}
for path in sorted(DIST.rglob("*")):
    if not path.is_file() or path == MANIFEST_PATH:
        continue
    relative = path.relative_to(DIST).as_posix()
    files[relative] = {
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
    }

manifest = {
    "schemaVersion": 1,
    "commit": commit,
    "commitDate": git_output("show", "-s", "--format=%cI", commit),
    "packageVersion": package_version,
    "files": files,
}

MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {MANIFEST_PATH.relative_to(ROOT)} for {commit[:12]} with {len(files)} files.")
