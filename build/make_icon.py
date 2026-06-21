import sys
sys.stdout.reconfigure(encoding="utf-8")
from PIL import Image, ImageDraw, ImageFont

S = 1024
SS = S * 4
img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

def scale(v):
    return int(round(v / 512 * SS))

top = (58, 125, 108)
bot = (40, 90, 78)
grad = Image.new("RGB", (1, SS))
for y in range(SS):
    t = y / (SS - 1)
    r = int(top[0] + (bot[0] - top[0]) * t)
    g = int(top[1] + (bot[1] - top[1]) * t)
    b = int(top[2] + (bot[2] - top[2]) * t)
    grad.putpixel((0, y), (r, g, b))
grad = grad.resize((SS, SS))

x0, y0, x1, y1 = scale(40), scale(40), scale(472), scale(472)
rad = scale(104)
mask = Image.new("L", (SS, SS), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([x0, y0, x1, y1], radius=rad, fill=255)
img.paste(grad, (0, 0), mask)

d.rounded_rectangle([x0, y0, x1, y1], radius=rad, outline=(255, 255, 255, 28), width=scale(3))

cream = (251, 247, 239, 255)
fsize = scale(262)
font = ImageFont.truetype(r"C:\Windows\Fonts\malgunbd.ttf", fsize)
ch = "生"
bbox = d.textbbox((0, 0), ch, font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
cx = scale(256) - tw / 2 - bbox[0]
cy = scale(232) - th / 2 - bbox[1]
d.text((cx, cy), ch, font=font, fill=cream)

gx, gy, gw, gh = scale(170), scale(372), scale(172), scale(18)
grad_r = scale(9)
d.rounded_rectangle([gx, gy, gx + gw, gy + gh], radius=grad_r, fill=(251, 247, 239, 77))
d.rounded_rectangle([gx, gy, gx + scale(116), gy + gh], radius=grad_r, fill=(154, 217, 196, 255))

img = img.resize((S, S), Image.LANCZOS)
img.save("icon-1024.png")

sizes = [16, 24, 32, 48, 64, 128, 256]
img.save("icon.ico", sizes=[(s, s) for s in sizes])
img.resize((256, 256), Image.LANCZOS).save("icon-256.png")
print("done", img.size)
