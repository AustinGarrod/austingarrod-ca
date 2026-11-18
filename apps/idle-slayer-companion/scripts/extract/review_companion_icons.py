"""Build numbered nearest-neighbor contact sheets for companion sprite review."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from private_paths import only_private_output


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog',type=Path,required=True)
    parser.add_argument('--icons',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    output=only_private_output(args.output)
    output.mkdir(parents=True,exist_ok=True)
    catalog=json.loads(args.catalog.read_text(encoding='utf8'))
    entities=[e for e in catalog['entities'] if e.get('icon')]
    columns,rows,width,height=12,10,94,76
    records=[]
    font=ImageFont.load_default(size=10)
    for start in range(0,len(entities),columns*rows):
        sheet=Image.new('RGB',(columns*width,rows*height),(22,21,30))
        draw=ImageDraw.Draw(sheet)
        for local,entity in enumerate(entities[start:start+columns*rows]):
            path=args.icons/Path(entity['icon']).name
            image=Image.open(path).convert('RGBA')
            x,y=(local%columns)*width,(local//columns)*height
            scale=min(3,56//max(image.size))
            enlarged=image.resize((image.width*scale,image.height*scale),Image.Resampling.NEAREST)
            sheet.paste(enlarged,(x+(width-enlarged.width)//2,y+4),enlarged)
            text=f'{start+local+1}: {entity["title"]}'
            draw.text((x+3,y+54),text[:18],fill=(245,231,191),font=font)
            draw.text((x+3,y+65),entity['system'],fill=(196,165,207),font=font)
            records.append({'number':start+local+1,'system':entity['system'],'id':entity['id'],'width':image.width,'height':image.height,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        sheet.save(output/f'companion-icons-{start//(columns*rows)+1:02}.png')
    inventory={'count':len(records),'records':records,'visualReviewComplete':False,'reviewEvidence':'Review every numbered sheet before setting complete.'}
    (output/'sprite-review-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n',encoding='utf8',newline='\n')
    print(json.dumps({'icons':len(records),'sheets':(len(records)+columns*rows-1)//(columns*rows)}))


if __name__=='__main__':
    main()
