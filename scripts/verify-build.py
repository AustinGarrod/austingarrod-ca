import hashlib
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
PROFILE_PATH = ROOT / "src" / "data" / "profile.json"
PRODUCTION_ORIGIN = "https://austingarrod.ca"

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def route_file(route: str) -> Path:
    if route == "/":
        return DIST / "index.html"
    return DIST / route.strip("/") / "index.html"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_output(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


with PROFILE_PATH.open(encoding="utf-8") as handle:
    data = json.load(handle)

with (ROOT / "package.json").open(encoding="utf-8") as handle:
    package_data = json.load(handle)

deployment_manifest_path = DIST / "deployment-manifest.json"
check(deployment_manifest_path.is_file(), "Missing deployment-manifest.json")
if deployment_manifest_path.is_file():
    deployment_manifest = json.loads(deployment_manifest_path.read_text(encoding="utf-8"))
    expected_commit = (os.environ.get("GITHUB_SHA", "").strip() or git_output("rev-parse", "HEAD")).lower()
    check(deployment_manifest.get("schemaVersion") == 1, "Deployment manifest schema is incorrect")
    check(
        re.fullmatch(r"[0-9a-f]{40}", str(deployment_manifest.get("commit", ""))) is not None,
        "Deployment manifest commit is invalid",
    )
    check(deployment_manifest.get("commit") == expected_commit, "Deployment manifest commit does not match the build")
    check(bool(deployment_manifest.get("commitDate")), "Deployment manifest commit date is missing")
    check(
        deployment_manifest.get("packageVersion") == package_data["version"],
        "Deployment manifest package version is incorrect",
    )
    recorded_files = deployment_manifest.get("files", {})
    actual_files = {
        path.relative_to(DIST).as_posix(): path
        for path in DIST.rglob("*")
        if path.is_file() and path != deployment_manifest_path
    }
    check(set(recorded_files) == set(actual_files), "Deployment manifest file set does not match dist/")
    for relative, path in actual_files.items():
        recorded = recorded_files.get(relative, {})
        check(recorded.get("bytes") == path.stat().st_size, f"Deployment manifest size mismatch: {relative}")
        check(recorded.get("sha256") == sha256(path), f"Deployment manifest hash mismatch: {relative}")

projects = data["projects"]
routes = ["/", "/about/", "/projects/", "/contact/"] + [
    f"/projects/{project['slug']}/" for project in projects
]

all_html: list[str] = []
for route in routes:
    path = route_file(route)
    check(path.is_file(), f"Missing built route: {route}")
    if not path.is_file():
        continue

    markup = path.read_text(encoding="utf-8")
    all_html.append(markup)
    expected_canonical = f"{PRODUCTION_ORIGIN}{route}"
    canonical_match = re.search(r'<link rel="canonical" href="([^"]+)"', markup)
    json_ld_match = re.search(
        r'<script type="application/ld\+json"[^>]*>(.*?)</script>',
        markup,
        flags=re.DOTALL,
    )
    ids = re.findall(r'\sid="([^"]+)"', markup)

    check(len(re.findall(r"<h1(?:\s|>)", markup)) == 1, f"{route} must contain exactly one h1")
    check(len(re.findall(r"<main(?:\s|>)", markup)) == 1, f"{route} must contain exactly one main")
    check(canonical_match is not None, f"{route} is missing a canonical link")
    if canonical_match:
        check(canonical_match.group(1) == expected_canonical, f"{route} has the wrong canonical URL")
    check(len(ids) == len(set(ids)), f"{route} contains duplicate ids")
    check("recorder.js" not in markup, f"{route} still loads session replay")
    check(json_ld_match is not None, f"{route} is missing JSON-LD")
    if json_ld_match:
        try:
            json_ld = json.loads(json_ld_match.group(1))
            check(isinstance(json_ld.get("@graph"), list), f"{route} JSON-LD is missing @graph")
            check(len(json_ld.get("@graph", [])) >= 3, f"{route} JSON-LD graph is incomplete")
        except json.JSONDecodeError:
            failures.append(f"{route} contains invalid JSON-LD")

combined_html = "\n".join(all_html)
for stale_phrase in [
    "5+",
    "Years at Epilogue",
    "at-risk people",
    "major retail brands",
    "worldwide Shopify",
    "Build and maintain production features across React and Next.js interfaces",
    "Open Design",
]:
    check(stale_phrase not in combined_html, f"Built HTML still contains stale or risky copy: {stale_phrase}")

about_markup = route_file("/about/").read_text(encoding="utf-8")
for required_experience_phrase in [
    "charity-partner systems",
    "scheduled AWS reporting",
    "Design access boundaries",
    "company leadership",
]:
    check(
        required_experience_phrase in about_markup,
        f"About is missing verified Epilogue evidence: {required_experience_phrase}",
    )
check("Permanent full-time" in about_markup, "About must clarify permanent employment where verified")
check(
    "Freelance; concurrent with teaching from May 2018" in about_markup,
    "About must clarify the verified freelance and teaching overlap",
)

projects_markup = route_file("/projects/").read_text(encoding="utf-8")
project_heading_links = re.findall(r'<h2><a href="/projects/[^\"]+/">', projects_markup)
check(len(project_heading_links) == len(projects), "Projects index must use one h2 per project card")
check("Private prototype" in projects_markup, "Projects index must label the NFC project as a prototype")

featured_paths = [
    "/projects/honour-our-veterans-banner-platform/",
    "/projects/cadence/",
    "/projects/spools/",
]
home_markup = route_file("/").read_text(encoding="utf-8")
featured_positions = [home_markup.find(f'href="{path}"') for path in featured_paths]
check(all(position >= 0 for position in featured_positions), "Homepage is missing an intended featured project")
check(featured_positions == sorted(featured_positions), "Homepage featured projects are in the wrong order")

not_found_path = DIST / "404.html"
check(not_found_path.is_file(), "Missing 404.html")
if not_found_path.is_file():
    not_found = not_found_path.read_text(encoding="utf-8")
    check('name="robots" content="noindex"' in not_found, "404 page must be noindex")
    check('aria-current="page"' not in not_found, "404 page must not mark a navigation item current")
    check("Browse projects" in not_found, "404 page must include a Projects action")

sitemap_path = DIST / "sitemap.xml"
check(sitemap_path.is_file(), "Missing sitemap.xml")
if sitemap_path.is_file():
    sitemap = ET.parse(sitemap_path).getroot()
    namespace = {"sitemap": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    sitemap_urls = {
        element.text
        for element in sitemap.findall("sitemap:url/sitemap:loc", namespace)
        if element.text
    }
    expected_urls = {f"{PRODUCTION_ORIGIN}{route}" for route in routes}
    check(sitemap_urls == expected_urls, "Sitemap URLs do not match the complete public route set")

manifest_path = DIST / "site.webmanifest"
check(manifest_path.is_file(), "Missing site.webmanifest")
if manifest_path.is_file():
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    check(manifest.get("icons", [{}])[0].get("sizes") == "any", "SVG manifest icon must use sizes=any")

htaccess_path = DIST / ".htaccess"
check(htaccess_path.is_file(), "Missing .htaccess")
if htaccess_path.is_file():
    htaccess = htaccess_path.read_text(encoding="utf-8")
    for directive in [
        "RewriteEngine On",
        "https://austingarrod.ca%{REQUEST_URI}",
        "Strict-Transport-Security",
        "application/manifest+json",
        "application/json",
        "max-age=3600, must-revalidate",
        "deployment-manifest.json",
        "no-store",
    ]:
        check(directive in htaccess, f".htaccess is missing required deployment directive: {directive}")

contact_path = DIST / "contact.php"
check(contact_path.is_file(), "Missing contact.php")
if contact_path.is_file():
    contact = contact_path.read_text(encoding="utf-8")
    for behavior in [
        "rate_limit_exceeded",
        "FILTER_VALIDATE_EMAIL",
        "flock",
        "$sender = 'austin@austingarrod.ca'",
        "'-f' . $sender",
        "mail(",
    ]:
        check(behavior in contact, f"contact.php is missing expected behavior: {behavior}")

og_path = DIST / "og-image.png"
check(og_path.is_file(), "Missing og-image.png")
if og_path.is_file():
    with Image.open(og_path) as image:
        check(image.size == (1200, 630), "Open Graph image must be 1200x630")

resume_path = DIST / "austin-garrod-resume.pdf"
check(resume_path.is_file(), "Missing resume PDF")
if resume_path.is_file():
    reader = PdfReader(str(resume_path))
    check(len(reader.pages) == 1, "Resume PDF must remain one page")
    check(str(reader.trailer["/Root"].get("/Lang")) == "en-CA", "Resume PDF must declare en-CA")
    metadata = reader.metadata or {}
    check(metadata.get("/Title") == "Austin Garrod Resume", "Resume PDF title metadata is incorrect")
    check(bool(metadata.get("/Subject")), "Resume PDF subject metadata is missing")
    font_resources = reader.pages[0]["/Resources"].get("/Font", {})
    embedded_font_names = []
    unembedded_font_names = []
    for font_reference in font_resources.values():
        font = font_reference.get_object()
        candidates = [font]
        candidates.extend(reference.get_object() for reference in font.get("/DescendantFonts", []))
        embedded = False
        for candidate in candidates:
            descriptor_reference = candidate.get("/FontDescriptor")
            if not descriptor_reference:
                continue
            descriptor = descriptor_reference.get_object()
            if any(key in descriptor for key in ["/FontFile", "/FontFile2", "/FontFile3"]):
                embedded = True
                break
        font_name = str(font.get("/BaseFont", "unknown"))
        (embedded_font_names if embedded else unembedded_font_names).append(font_name)
    check(any("Inter-Regular" in name for name in embedded_font_names), "Resume PDF must embed Inter Regular")
    check(any("Inter-Bold" in name for name in embedded_font_names), "Resume PDF must embed Inter Bold")
    check(not unembedded_font_names, f"Resume PDF contains unembedded fonts: {unembedded_font_names}")
    resume_links = set()
    for page in reader.pages:
        for annotation_reference in page.get("/Annots", []):
            annotation = annotation_reference.get_object()
            action = annotation.get("/A")
            if action and action.get("/URI"):
                resume_links.add(str(action["/URI"]))
    expected_resume_links = {
        "mailto:austin.r.garrod@gmail.com",
        "https://austingarrod.ca/",
        "https://github.com/AustinGarrod",
        "https://www.linkedin.com/in/austingarrod",
    }
    check(expected_resume_links.issubset(resume_links), "Resume PDF is missing one or more contact hyperlinks")
    resume_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    for stale_phrase in ["at-risk people", "major retail brands", "worldwide Shopify", "Kids TV Controller"]:
        check(stale_phrase not in resume_text, f"Resume PDF still contains stale or risky copy: {stale_phrase}")
    check("Honour Our Veterans Banner Platform" in resume_text, "Resume PDF must feature public civic work")
    check("Permanent full-time" in resume_text, "Resume PDF must clarify verified permanent employment")
    check(
        "Freelance; concurrent with teaching from May 2018" in resume_text,
        "Resume PDF must clarify the verified freelance and teaching overlap",
    )

if failures:
    print("Deployment verification failed:")
    for failure in failures:
        print(f"- {failure}")
    sys.exit(1)

print(
    f"Verified {len(routes)} routes, {len(projects)} projects, the deployment manifest and headers, "
    "Open Graph artwork, and the linked one-page resume."
)
