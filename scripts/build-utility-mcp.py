"""Bundle rule inputs from the Companion and skill ZIPs from the plugins."""
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
for name in ("pokedex-binder", "idle-slayer-companion"):
    skill = root / "plugins" / name / "skills" / name / "SKILL.md"
    entry = ZipInfo(f"{name}/SKILL.md", (2026, 1, 1, 0, 0, 0))
    with ZipFile(bundles / f"{name}.zip", "w") as archive:
        archive.writestr(entry, skill.read_bytes(), compress_type=ZIP_DEFLATED)
