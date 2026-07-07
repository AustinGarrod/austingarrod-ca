from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUTPUT = ROOT / "output" / "pdf"

PUBLIC.mkdir(exist_ok=True)
OUTPUT.mkdir(parents=True, exist_ok=True)


def font(name: str, size: int):
    candidates = [
        Path("C:/Windows/Fonts") / name,
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_wrapped(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], font_obj, fill, width: int, line_height: int):
    x, y = xy
    for line in wrap(text, width=width):
        draw.text((x, y), line, font=font_obj, fill=fill)
        y += line_height
    return y


def generate_og_image():
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
    draw.text((128, 104), "Austin Garrod", font=title_font, fill="#0b1c30")
    draw.text((132, 202), "Senior Full Stack Developer", font=subtitle_font, fill="#006a61")
    draw_wrapped(
        draw,
        "Building resilient, scalable web applications from database architecture to frontend UI.",
        (132, 286),
        mono_font,
        "#45464d",
        68,
        34,
    )
    draw.rectangle((830, 118, 1068, 420), outline="#0b1c30", width=2)
    draw.rectangle((858, 150, 868, 160), fill="#c6c6cd")
    draw.rectangle((888, 150, 898, 160), fill="#d3e4fe")
    draw.rectangle((918, 150, 928, 160), fill="#006a61")
    for i, w in enumerate([152, 110, 174, 92, 136]):
        y = 208 + i * 36
        color = "#006a61" if i == 1 else "#dce9ff"
        draw.rectangle((862, y, 862 + w, y + 12), fill=color)
    draw.rectangle((96, 456, 360, 502), fill="#000000")
    draw.text((122, 468), "SELECTED WORKS", font=mono_font, fill="#ffffff")
    img.save(PUBLIC / "og-image.png", quality=92)


def paragraph(text: str, style: ParagraphStyle):
    return Paragraph(text.replace("&", "&amp;"), style)


def generate_resume():
    for path in [PUBLIC / "austin-garrod-resume.pdf", OUTPUT / "austin-garrod-resume.pdf"]:
        doc = SimpleDocTemplate(
            str(path),
            pagesize=LETTER,
            rightMargin=0.46 * inch,
            leftMargin=0.46 * inch,
            topMargin=0.42 * inch,
            bottomMargin=0.42 * inch,
            title="Austin Garrod Resume",
            author="Austin Garrod",
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
                fontSize=10,
                leading=12,
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
                fontSize=7.7,
                leading=9.25,
                textColor=colors.HexColor("#45464d"),
                spaceAfter=2,
            )
        )
        styles.add(
            ParagraphStyle(
                name="Role",
                parent=styles["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=8.4,
                leading=9.8,
                textColor=colors.HexColor("#0b1c30"),
                spaceAfter=1,
            )
        )

        body = styles["BodySmall"]
        role = styles["Role"]
        section = styles["Section"]
        story = []
        story.append(Paragraph("Austin Garrod", styles["ResumeTitle"]))
        story.append(
            paragraph(
                "Senior Full Stack Developer | Port Perry, Ontario, Canada | austin.r.garrod@gmail.com | github.com/AustinGarrod | linkedin.com/in/austingarrod",
                body,
            )
        )
        story.append(Spacer(1, 4))
        story.append(
            paragraph(
                "Senior full-stack developer building maintainable product software across React, Next.js, React Native, Node.js, APIs, databases, native-adjacent tooling, and deployment workflows. Background includes technical education, project leadership, research systems, civic software, and practical local systems.",
                body,
            )
        )

        story.append(Paragraph("Core Skills", section))
        skills = [
            ["Frontend", "React, Next.js, TypeScript, React Native, Redux, Tailwind CSS"],
            ["Backend", "Node.js, Express, API development, MongoDB, SQL, Socket.IO, BullMQ"],
            ["Platform", "Kotlin Multiplatform, Android, C#/.NET, Python, Docker, MQTT"],
            ["Leadership", "Agile and waterfall methods, SDLC, mentoring, estimates, troubleshooting"],
        ]
        table = Table([[paragraph(a, role), paragraph(b, body)] for a, b in skills], colWidths=[1.18 * inch, 5.6 * inch])
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
        jobs = [
            (
                "Senior Full Stack Developer - Epilogue",
                "Aug 2021 - Present | Toronto, Ontario, Canada - Remote",
                [
                    "Senior product engineering work across modern full-stack surfaces, with React and Next.js highlighted on LinkedIn.",
                    "Apply TypeScript, React, Next.js, API development, and database experience to practical product work.",
                ],
            ),
            (
                "Lead Full-stack Developer - Tidal",
                "Apr 2021 - Jul 2021 | Richmond Hill, Ontario, Canada",
                [
                    "Led front-end development, upkeep, and management of corporate web applications across multiple industries.",
                    "Worked with major retail brands on worldwide Shopify stores across front-end and back-end maintenance.",
                ],
            ),
            (
                "Professor, Computer Programming and Project Management - Durham College",
                "May 2018 - Apr 2021 | Oshawa, Ontario, Canada",
                [
                    "Developed and taught web development, Windows application development, modern JavaScript, and project management courses.",
                    "Mentored students and alumni on software development choices for early-stage businesses.",
                ],
            ),
            (
                "Freelancer - Austin Garrod",
                "May 2017 - Apr 2021 | Ontario, Canada",
                [
                    "Designed branded web presences, CMS implementations, and social media presences for organizations.",
                    "Built web experiences with React, Meteor, and established web standards.",
                ],
            ),
            (
                "Research Specialist - Durham College, ORSIE",
                "Aug 2016 - Apr 2017 | Oshawa, Ontario, Canada",
                [
                    "Worked on applied research systems including React/Node vehicle analytics, iOS item tracking, and responsive Meteor applications.",
                    "Reworked a Meteor web app to improve accessibility across devices for senior users.",
                ],
            ),
        ]
        for title, meta, bullets in jobs:
            story.append(paragraph(title, role))
            story.append(paragraph(meta, body))
            for bullet in bullets:
                story.append(paragraph("- " + bullet, body))

        story.append(Paragraph("Selected Projects", section))
        project_text = [
            "Open Design - public TypeScript-heavy agentic design workspace with web, desktop, plugin, and export surfaces.",
            "Cadence - private Kotlin Multiplatform podcast app with local-first state, opt-out diagnostics, and Pocket Casts import support.",
            "Spools - local web app for 3D printer filament tracking with Bambu Lab AMS sync over MQTT.",
            "Charity Data Scraper - queue-based Canadian charity data scraper with Redis/BullMQ, MongoDB, WebSocket progress, and Docker deployment.",
            "Kids TV Controller - household NFC media controller concept with React dashboard, Express API, Plex/Chromecast integration, and ESP32 hardware planning.",
        ]
        for item in project_text:
            story.append(paragraph("- " + item, body))

        story.append(Paragraph("Education and Certifications", section))
        story.append(paragraph("Durham College - Diploma, Computer Programming/Programmer, General, 2016 - 2017.", body))
        story.append(paragraph("PMI Certified Associate in Project Management (CAPM), issued Apr 2018. LinkedIn lists expiry Apr 2026; renewal status not claimed on this resume.", body))

        doc.build(story)


if __name__ == "__main__":
    generate_og_image()
    generate_resume()
    print("Generated public/og-image.png and public/austin-garrod-resume.pdf")
