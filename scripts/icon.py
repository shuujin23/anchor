from PIL import Image, ImageDraw
from pathlib import Path
root = Path(__file__).resolve().parent.parent / 'assets'
root.mkdir(exist_ok=True)
im = Image.new('RGBA', (256,256), (0,0,0,0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((8,8,248,248), radius=58, fill='#6153d9')
d.ellipse((107,48,149,90),outline='white',width=12)
d.line((128,86,128,192),fill='white',width=13)
d.line((89,111,167,111),fill='white',width=12)
d.arc((60,88,196,202),0,180,fill='white',width=13)
d.polygon([(51,143),(72,122),(84,151)],fill='white')
d.polygon([(172,151),(184,122),(205,143)],fill='white')
im.save(root/'icon.png')
im.save(root/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
