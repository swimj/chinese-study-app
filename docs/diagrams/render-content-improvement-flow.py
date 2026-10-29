"""Render the content-improvement architecture image (requires Pillow).

Run from any directory: python3 docs/diagrams/render-content-improvement-flow.py
Use --font and --bold-font to supply local TrueType fonts when necessary.
"""
from PIL import Image, ImageDraw, ImageFont
from math import atan2,cos,sin
from pathlib import Path
import argparse
W,H=1700,2110
im=Image.new('RGB',(W,H),'#f8fafc');d=ImageDraw.Draw(im)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--font')
parser.add_argument('--bold-font')
args=parser.parse_args()
mac=Path('/System/Library/Fonts/Supplemental')
font=args.font or (str(mac/'Arial.ttf') if (mac/'Arial.ttf').exists() else 'DejaVuSans.ttf')
bold=args.bold_font or (str(mac/'Arial Bold.ttf') if (mac/'Arial Bold.ttf').exists() else 'DejaVuSans-Bold.ttf')
f=lambda n,b=False:ImageFont.truetype(bold if b else font,n)
ink='#172b42';line='#66788a'
def text(x,y,t,size=26,b=False,color=ink):
 lines=t.split('\n');height=size*1.25
 for i,s in enumerate(lines):d.text((x,y+(i-(len(lines)-1)/2)*height),s,font=f(size,b),fill=color,anchor='mm')
def box(x,y,w,h,t,call=False,terminal=False):
 fill,outline=('#dbeafe','#2563eb') if call else (('#fef3c7','#c29128') if terminal else ('#ffffff','#a7b5c5'))
 d.rounded_rectangle((x-w/2,y-h/2,x+w/2,y+h/2),radius=16,fill=fill,outline=outline,width=3)
 text(x,y,t,26,call)
def diamond(x,y,w,h,t):
 d.polygon([(x,y-h/2),(x+w/2,y),(x,y+h/2),(x-w/2,y)],fill='#edf2f7',outline='#8b9bad',width=3);text(x,y,t,24,True)
def arrow(points,label=None,lp=None):
 d.line(points,fill=line,width=3)
 x,y=points[-1];a=atan2(y-points[-2][1],x-points[-2][0]);l=14
 d.polygon([(x,y),(x-l*cos(a-.45),y-l*sin(a-.45)),(x-l*cos(a+.45),y-l*sin(a+.45))],fill=line)
 if label:
  x,y=lp;bb=d.textbbox((x,y),label,font=f(22),anchor='mm');d.rectangle((bb[0]-7,bb[1]-5,bb[2]+7,bb[3]+5),fill='#f8fafc');text(x,y,label,22)
text(850,58,'Backend content improvement',43,True)
text(850,108,'Blue boxes are provider calls • Other steps run in the backend',25)
box(850,190,480,80,'Single-word production job')
diamond(850,325,420,120,'Canonical inventory\nready?')
arrow([(850,230),(850,265)])
box(300,465,440,100,'Legacy source; no inventory\nOperator / cutover required',terminal=True)
box(1390,465,440,100,'CALL: Full inventory +\ndefault useful selection',True)
arrow([(640,325),(300,325),(300,415)],'Legacy source only', (445,325))
arrow([(1060,325),(1390,325),(1390,415)],'Fresh lexical word',(1350,300))
box(850,620,500,100,'CALL: Assess authored cue\nand map intended sense',True)
arrow([(850,385),(850,570)],'Already ready',(850,470))
arrow([(1390,515),(1390,550),(970,550),(970,570)])
diamond(850,755,420,110,'Canonical mapping outcome')
arrow([(850,670),(850,700)])
box(290,890,450,110,'Operator finding\nNo further generation',terminal=True)
arrow([(640,755),(290,755),(290,835)],'Gap / unmappable',(290,795))
box(1400,880,500,140,'Capture repertoire scope\nUnknown: initialize defaults\nEmpty: no action · failed: review')
arrow([(1060,755),(1400,755),(1400,835)],'Laundry list',(1400,795))
box(1400,1050,450,100,'CALL: Generate\nsense-based repertoire',True)
arrow([(1400,950),(1400,1000)],'Nonempty scope',(1400,975))
box(1400,1200,450,100,'Save replacement + additions\nAwait operator approval',terminal=True)
arrow([(1400,1100),(1400,1150)])
box(850,940,500,120,'CALL: Local improvement — r5\nLocal drafts + optional referral',True)
arrow([(850,810),(850,880)],'Single sense; record mapping',(850,845))
diamond(850,1120,420,110,'Pure-cue referral?')
arrow([(850,1000),(850,1065)])
box(290,1270,450,100,'Save any local drafts\nAwait operator approval',terminal=True)
arrow([(640,1120),(290,1120),(290,1220)],'No',(460,1120))
box(850,1280,500,100,'Resolve candidate words\nto lexical identities')
arrow([(850,1175),(850,1230)],'Yes',(850,1200))
diamond(850,1420,440,110,'Unambiguous identities?')
arrow([(850,1330),(850,1365)])
box(290,1540,450,120,'Operator finding\nKeep any local drafts',terminal=True)
arrow([(630,1420),(290,1420),(290,1480)],'No',(450,1420))
box(850,1570,500,100,'Find overlapping pure cues\nSame publication scope')
arrow([(850,1475),(850,1520)],'Yes',(850,1498))
box(850,1720,570,110,'CALL: Pure-cue promotion\nReject · reuse · extend · create',True)
arrow([(850,1620),(850,1665)])
box(850,1880,660,120,'Persist local drafts + promotion result\nAll content edits await operator approval',terminal=True)
arrow([(850,1775),(850,1820)])
d.rounded_rectangle((65,1990,1635,2080),radius=12,fill='#eaf0f6')
text(850,2019,'Existing pure cues → dedicated review: extend + teaching · repair stimulus · explanation only',23)
text(850,2055,'Recognition / contrast → no calls • Teaching → manual inbox • Learner feedback → separate call',23)
p=Path(__file__).with_name('content-improvement-provider-flow.png');p.parent.mkdir(parents=True,exist_ok=True);im.save(p)
print(p)
