"""Bundle Companion rule inputs and assistant installation ZIPs."""
from pathlib import Path
from shutil import copyfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
data = dist / "api/v1/_mcp-data"
data.mkdir(parents=True, exist_ok=True)
(data / ".htaccess").write_text("Require all denied\n", encoding="ascii")
source = root / "apps/idle-slayer-companion/src/data"
for name in ("companion-reset-rules.json", "wiki-priorities.json"):
    copyfile(source / name, data / name)

vendor = dist / "api/v1/_mcp-vendor"
if vendor.is_dir():
    (vendor / ".htaccess").write_text("Require all denied\n", encoding="ascii")

bundles = dist / "account/assistant-skills"
bundles.mkdir(parents=True, exist_ok=True)


def write_bundle(filename, source, entries):
    with ZipFile(bundles / filename, "w") as archive:
        for path in entries:
            entry = ZipInfo(path, (2026, 1, 1, 0, 0, 0))
            archive.writestr(entry, (source / path).read_bytes(), compress_type=ZIP_DEFLATED)


for name in ("pokedex-binder", "idle-slayer-companion"):
    plugin = root / "plugins" / name
    skill = f"{name}/SKILL.md"
    write_bundle(f"{name}.zip", plugin / "skills", [skill])
    write_bundle(f"{name}-plugin.zip", plugin, [".claude-plugin/plugin.json", ".mcp.json", f"skills/{skill}"])
