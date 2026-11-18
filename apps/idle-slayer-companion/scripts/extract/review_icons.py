"""Validate the extracted sprite set and build private numbered review sheets."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

from extract_assets import only_private_output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = only_private_output(args.output)
    output.mkdir(parents=True, exist_ok=True)
    data = json.loads(args.export.read_text(encoding="utf8"))
    records = []
    sheets = []
    for index, upgrade in enumerate(data["upgrades"]):
        path = args.export.parent / upgrade["icon"]
        with Image.open(path) as image:
            image.load()
            if image.size != (upgrade["iconSource"]["width"], upgrade["iconSource"]["height"]):
                raise ValueError("Sprite dimensions changed after extraction")
            alpha = image.convert("RGBA").getchannel("A")
            if alpha.getbbox() is None:
                raise ValueError("Fully transparent upgrade sprite")
            records.append({"number": index + 1, "id": upgrade["id"], "title": upgrade["title"], "sourcePathId": upgrade["iconSource"]["pathId"], "width": image.width, "height": image.height, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
            if index % 48 == 0:
                sheets.append(Image.new("RGB", (1200, 768), "#211c18"))
            sheet = sheets[-1]
            draw = ImageDraw.Draw(sheet)
            local_index = index % 48
            x, y = (local_index % 8) * 150, (local_index // 8) * 128
            draw.rectangle((x + 4, y + 4, x + 146, y + 123), outline="#9e824b")
            scale = max(1, min(3, 90 // max(image.size)))
            displayed = image.convert("RGBA").resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST)
            sheet.paste(displayed, (x + (150 - displayed.width) // 2, y + 8 + (80 - displayed.height) // 2), displayed)
            draw.text((x + 8, y + 91), f"{index + 1:03}: {upgrade['title'][:21]}", fill="#f8efd9")
            draw.text((x + 8, y + 106), f"{image.width}x{image.height} / {upgrade['id'][:10]}", fill="#bfb199")
    for index, sheet in enumerate(sheets):
        sheet.save(output / f"icons-{index + 1:02}.png")
    (output / "sprite-review-inventory.json").write_text(json.dumps({"count": len(records), "records": records, "visualReviewComplete": False}, indent=2) + "\n", encoding="utf8", newline="\n")
    print(json.dumps({"sprites": len(records), "reviewSheets": len(sheets), "dimensions": sorted(set((record["width"], record["height"]) for record in records))}))


if __name__ == "__main__":
    main()
