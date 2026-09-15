"""Build print-ready companions after build-rep-guides.mjs.

Requires reportlab and beautifulsoup4. HTML remains the source of every paragraph.
Run: python scripts/build-rep-guide-pdfs.py
"""
from pathlib import Path
import sys
from html import escape
from bs4 import BeautifulSoup, NavigableString
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, KeepTogether, Table, TableStyle, Image

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'web/public/workshops'
INK = colors.HexColor('#20292c')
styles = {
    'p': ParagraphStyle('Body', fontName='Helvetica', fontSize=10, leading=14, spaceAfter=8, textColor=INK),
    'h1': ParagraphStyle('Title', fontName='Helvetica-Bold', fontSize=25, leading=29, spaceAfter=16, keepWithNext=True, textColor=INK),
    'h2': ParagraphStyle('Section', fontName='Helvetica-Bold', fontSize=16, leading=19, spaceBefore=16, spaceAfter=9, keepWithNext=True, textColor=INK),
    'h3': ParagraphStyle('Activity', fontName='Helvetica-Bold', fontSize=12, leading=16, spaceBefore=7, spaceAfter=7, keepWithNext=True, textColor=INK),
    'li': ParagraphStyle('List', fontName='Helvetica', fontSize=10, leading=14, leftIndent=12, firstLineIndent=-9, spaceAfter=5, textColor=INK),
    'blockquote': ParagraphStyle('Model', fontName='Helvetica-Oblique', fontSize=10, leading=14, leftIndent=15, rightIndent=10, spaceBefore=5, spaceAfter=10, textColor=INK),
    'meta': ParagraphStyle('Cue', fontName='Helvetica', fontSize=8, leading=11, spaceBefore=12, spaceAfter=3, keepWithNext=True, textColor=colors.HexColor('#51635c')),
}

def clean(text):
    return text.translate(str.maketrans({'\u2011':'-', '\u2013':'-', '\u2014':' - ', '\u2192':' -> ', '\u202f':' ', '\u00a0':' '}))

def inline(node):
    if isinstance(node, NavigableString):
        return escape(clean(str(node)))
    inner = ''.join(inline(child) for child in node.children)
    if node.name == 'strong': return f'<b>{inner}</b>'
    if node.name in ('em','i'): return f'<i>{inner}</i>'
    if node.name == 'br': return '<br/>'
    if node.name == 'a' and node.get('href','').startswith('https://'):
        return f'<a href="{escape(node["href"],quote=True)}" color="#234c69">{inner}</a>'
    return inner

def flow(node):
    if isinstance(node,NavigableString) or node.name == 'nav': return []
    if 'lesson-phones' in node.get('class',[]):
        images = []
        for tag in node.find_all('img'):
            relative = tag.get('src','').removeprefix('/workshops/')
            asset = (DIRECTORY / relative).resolve()
            if asset.is_relative_to(DIRECTORY.resolve()) and asset.exists():
                image = Image(str(asset))
                factor = min(200 / image.imageWidth, 300 / image.imageHeight)
                image.drawWidth = image.imageWidth * factor
                image.drawHeight = image.imageHeight * factor
                images.append(image)
        return [Table([images], hAlign='LEFT'), Spacer(1,12)] if images else []
    if node.name == 'strong': return [Paragraph(inline(node),styles['h2'])]
    if node.name == 'table':
        rows = [[Paragraph(inline(cell), styles['p']) for cell in row.find_all(['th','td'],recursive=False)] for row in node.find_all('tr')]
        table = Table(rows, colWidths=[130,150,248], repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e8eee8')),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#adbab3')),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
        return [table,Spacer(1,12)]
    if 'writing' in node.get('class',[]):
        return [Spacer(1,45), HRFlowable(width='100%',thickness=.4,color=colors.HexColor('#adbab3')),Spacer(1,10)]
    if node.name in styles:
        key = 'meta' if 'meta' in node.get('class',[]) else node.name
        text = inline(node)
        if node.name == 'li': text = '- ' + text
        paragraph = Paragraph(text,styles[key])
        if node.name == 'p' and node.get_text(strip=True).endswith(':'):
            paragraph.keepWithNext = True
        return [paragraph]
    result = []
    children = [child for child in node.children if not isinstance(child,NavigableString)]
    index = 0
    while index < len(children):
        child = children[index]
        if index + 1 < len(children) and 'writing' in children[index+1].get('class',[]):
            result.append(KeepTogether(flow(child) + flow(children[index+1])))
            index += 2
        else:
            result.extend(flow(child))
            index += 1
    if node.name == 'ul': return [KeepTogether(result)]
    return result

for day in range(1,5):
    if len(sys.argv) > 1 and int(sys.argv[1]) != day:
        continue
    for kind in ('guide','resources'):
        source = DIRECTORY / f'day{day}-{kind}.html'
        soup = BeautifulSoup(source.read_text(encoding='utf-8'),'html.parser')
        title = f'Day {day} ' + ('facilitator guide' if kind == 'guide' else 'agent reference and practice notes' if day == 2 else 'agent worksheet')
        output = source.with_suffix('.pdf')
        def footer(canvas,doc):
            canvas.saveState()
            canvas.setFont('Helvetica',8)
            canvas.setFillColor(colors.HexColor('#51635c'))
            canvas.drawString(42,25,f'TRU Rep | {title}')
            canvas.drawRightString(letter[0]-42,25,str(doc.page))
            canvas.restoreState()
        doc = SimpleDocTemplate(str(output),pagesize=letter,rightMargin=42,leftMargin=42,
            topMargin=35,bottomMargin=43,title=title,author='TRU',allowSplitting=True)
        doc.build(flow(soup.main),onFirstPage=footer,onLaterPages=footer)
        print(output.name)
