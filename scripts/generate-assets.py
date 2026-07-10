import json
from functools import partial
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, TextStringObject

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUTPUT = ROOT / "output" / "pdf"
PROFILE_JSON = ROOT / "src" / "data" / "profile.json"

PUBLIC.mkdir(exist_ok=True)
OUTPUT.mkdir(parents=True, exist_ok=True)


def load_profile_data():
    with PROFILE_JSON.open(encoding="utf-8") as handle:
        return json.load(handle)


def font(name: str, size: int):
    candidates = [
        Path("C:/Windows/Fonts") / name,
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def text_width(draw: ImageDraw.ImageDraw, text: str, font_obj) -> int:
    bbox = draw.textbbox((0, 0), text, font=font_obj)
    return bbox[2] - bbox[0]


def wrap_by_pixels(draw: ImageDraw.ImageDraw, text: str, font_obj, max_width: int):
    words = text.split()
    lines: list[str] = []
    current = ""

    for word in words:
        candidate = f"{current} {word}".strip()
        if current and text_width(draw, candidate, font_obj) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate

    if current:
        lines.append(current)

    return lines


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    font_obj,
    fill,
    max_width: int,
    line_height: int,
):
    x, y = xy
    for line in wrap_by_pixels(draw, text, font_obj, max_width):
        draw.text((x, y), line, font=font_obj, fill=fill)
        y += line_height
    return y


def generate_og_image(data):
    profile = data["profile"]
    img = Image.new("RGB", (1200, 630), "#f8f9ff")
    draw = ImageDraw.Draw(img)
    title_font = font("arialbd.ttf", 78)
    subtitle_font = font("arial.ttf", 34)
    mono_font = font("consola.ttf", 24)

    for x in range(0, 1200, 100):
        draw.line((x, 0, x, 630), fill="#e5e8f0")
    for y in range(0, 630, 100):
        draw.line((0, y, 1200, y), fill="#e5e8f0")

    draw.rectangle((72, 72, 1128, 558), outline="#c6c6cd", width=2)
    draw.rectangle((96, 112, 104, 326), fill="#000000")
    draw.text((128, 104), profile["name"], font=title_font, fill="#0b1c30")
    draw.text((132, 202), profile["title"], font=subtitle_font, fill="#006a61")
    draw_wrapped(
        draw,
        profile["tagline"],
        (132, 286),
        mono_font,
        "#45464d",
        640,
        34,
    )
    draw.rectangle((830, 118, 1068, 420), outline="#0b1c30", width=2)
    draw.rectangle((858, 150, 868, 160), fill="#c6c6cd")
    draw.rectangle((888, 150, 898, 160), fill="#d3e4fe")
    draw.rectangle((918, 150, 928, 160), fill="#006a61")
    for i, width in enumerate([152, 110, 174, 92, 136]):
        y = 208 + i * 36
        color = "#006a61" if i == 1 else "#dce9ff"
        draw.rectangle((862, y, 862 + width, y + 12), fill=color)
    draw.rectangle((96, 456, 360, 502), fill="#000000")
    draw.text((122, 468), "SELECTED WORK", font=mono_font, fill="#ffffff")
    img.save(PUBLIC / "og-image.png", quality=92)


def paragraph(text: str, style: ParagraphStyle):
    return Paragraph(escape(text), style)


def resume_link(label: str, url: str) -> str:
    return f'<link href="{escape(url)}" color="#006a61">{escape(label)}</link>'


def enrich_resume_pdf(path: Path, profile):
    reader = PdfReader(str(path))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    metadata = writer._info.get_object()
    metadata.pop(NameObject("/CreationDate"), None)
    metadata.pop(NameObject("/ModDate"), None)
    writer._ID = None
    writer.add_metadata(
        {
            "/Title": f"{profile['name']} Resume",
            "/Author": profile["name"],
            "/Subject": f"Resume for {profile['name']}, {profile['title']}",
            "/Keywords": "senior full-stack developer, React, Next.js, TypeScript, Node.js, APIs, databases",
            "/Creator": "AustinGarrod.ca asset generator",
        }
    )
    writer._root_object.update({NameObject("/Lang"): TextStringObject("en-CA")})

    temporary = path.with_suffix(".tmp.pdf")
    with temporary.open("wb") as handle:
        writer.write(handle)
    temporary.replace(path)


def resume_skill_label(title: str) -> str:
    labels = {
        "Frontend engineering": "Frontend",
        "Backend and data": "Backend",
        "Native and platform work": "Platform",
        "Engineering practice": "Practice",
    }
    return labels.get(title, title)


def generate_resume(data):
    profile = data["profile"]
    skills = data["skills"]
    experience = data["experience"]
    projects = data["projects"]
    project_by_slug = {project["slug"]: project for project in projects}
    selected_projects = [
        project_by_slug[slug]
        for slug in [
            "honour-our-veterans-banner-platform",
            "cadence",
            "spools",
            "charity-data-scraper",
            "austingarrod-ca",
        ]
        if slug in project_by_slug
    ]

    for path in [PUBLIC / "austin-garrod-resume.pdf", OUTPUT / "austin-garrod-resume.pdf"]:
        doc = SimpleDocTemplate(
            str(path),
            pagesize=LETTER,
            rightMargin=0.46 * inch,
            leftMargin=0.46 * inch,
            topMargin=0.42 * inch,
            bottomMargin=0.42 * inch,
            title=f"{profile['name']} Resume",
            author=profile["name"],
        )
        styles = getSampleStyleSheet()
        styles.add(
            ParagraphStyle(
                name="ResumeTitle",
                parent=styles["Title"],
                fontName="Helvetica-Bold",
                fontSize=22,
                leading=25,
                textColor=colors.HexColor("#0b1c30"),
                spaceAfter=2,
            )
        )
        styles.add(
            ParagraphStyle(
                name="Section",
                parent=styles["Heading2"],
                fontName="Helvetica-Bold",
                fontSize=10.5,
                leading=12.5,
                textColor=colors.HexColor("#006a61"),
                spaceBefore=7,
                spaceAfter=3,
            )
        )
        styles.add(
            ParagraphStyle(
                name="BodySmall",
                parent=styles["BodyText"],
                fontName="Helvetica",
                fontSize=8.5,
                leading=10.2,
                textColor=colors.HexColor("#45464d"),
                spaceAfter=2,
            )
        )
        styles.add(
            ParagraphStyle(
                name="Role",
                parent=styles["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=9,
                leading=10.5,
                textColor=colors.HexColor("#0b1c30"),
                spaceAfter=1,
            )
        )

        body = styles["BodySmall"]
        role = styles["Role"]
        section = styles["Section"]
        story = []
        story.append(Paragraph(escape(profile["name"]), styles["ResumeTitle"]))
        contact_line = " | ".join(
            [
                escape(profile["title"]),
                escape(profile["location"]),
                resume_link(profile["email"], f"mailto:{profile['email']}"),
                resume_link("austingarrod.ca", "https://austingarrod.ca/"),
                resume_link("GitHub", profile["github"]),
                resume_link("LinkedIn", profile["linkedin"]),
            ]
        )
        story.append(Paragraph(contact_line, body))
        story.append(Spacer(1, 4))
        story.append(paragraph(profile["intro"], body))

        story.append(Paragraph("Core Skills", section))
        skill_rows = [
            [paragraph(resume_skill_label(skill["title"]), role), paragraph(", ".join(skill["items"]), body)]
            for skill in skills
        ]
        table = Table(skill_rows, colWidths=[1.18 * inch, 5.6 * inch])
        table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LINEBELOW", (0, 0), (-1, -2), 0.35, colors.HexColor("#c6c6cd")),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                    ("TOPPADDING", (0, 0), (-1, -1), 2),
                ]
            )
        )
        story.append(table)

        story.append(Paragraph("Experience", section))
        for job in experience:
            story.append(paragraph(f"{job['role']} - {job['organization']}", role))
            story.append(paragraph(f"{job['dates']} | {job['location']}", body))
            for bullet in job["bullets"][:2]:
                story.append(paragraph("- " + bullet, body))

        story.append(Paragraph("Selected Projects", section))
        for project in selected_projects:
            highlight = project["cardHighlights"][0] if project["cardHighlights"] else project["summary"]
            story.append(paragraph(f"- {project['title']} - {highlight}", body))

        story.append(Paragraph("Education", section))
        story.append(
            paragraph(
                "Durham College - Diploma, Computer Programming/Programmer, General, 2016 - 2017. Foundation in programming logic, object-oriented development, databases, networking, web development, testing, systems development, and technical communication.",
                body,
            )
        )

        doc.build(story, canvasmaker=partial(canvas.Canvas, invariant=1))
        enrich_resume_pdf(path, profile)


if __name__ == "__main__":
    profile_data = load_profile_data()
    generate_og_image(profile_data)
    generate_resume(profile_data)
    print("Generated public/og-image.png and public/austin-garrod-resume.pdf")
