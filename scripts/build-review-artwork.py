from pathlib import Path
from PIL import Image
root=Path('web/public/workshops')
out=root/'review-artwork';out.mkdir(exist_ok=True)
files={'property':root/'tru-website-poster.jpg','home':root/'house.jpg'}
for name in ['arrival','follow-up','coaching','questions','concern','practice','conversation']:
 files[name]=root/'backdrops'/(name+('.jpg' if name in ['coaching','practice'] else '.png'))
for name,source in files.items():
 im=Image.open(source).convert('RGB');im.thumbnail((1800,1200))
 im.save(out/(name+'.jpg'),quality=86,optimize=True)
 print(name,(out/(name+'.jpg')).stat().st_size)
