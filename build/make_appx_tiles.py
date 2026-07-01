import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from PIL import Image

SRC = os.path.join(os.path.dirname(__file__), 'icon-256.png')
OUT = os.path.join(os.path.dirname(__file__), 'appx')
os.makedirs(OUT, exist_ok=True)
BG = (43, 93, 68, 255)  # 생기부 forest, 타일 배경

src = Image.open(SRC).convert('RGBA')

# electron-builder appx 표준 자산: 파일명 -> (width, height, 로고비율)
# 로고비율 = 캔버스 대비 아이콘 크기(여백 확보). 정사각 타일은 로고가 가운데.
ASSETS = {
    'Square44x44Logo.png':   (44, 44, 1.0),
    'Square150x150Logo.png': (150, 150, 0.66),
    'Square310x310Logo.png': (310, 310, 0.66),
    'Wide310x150Logo.png':   (310, 150, 0.0),  # 가로 타일: 높이 기준 정사각 로고 중앙
    'StoreLogo.png':         (50, 50, 1.0),
    'SplashScreen.png':      (620, 300, 0.0),  # 스플래시: 중앙 로고
}

def make(name, w, h, ratio):
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))  # 투명 배경(권장)
    if name in ('Square150x150Logo.png', 'Square310x310Logo.png', 'Wide310x150Logo.png', 'SplashScreen.png'):
        canvas = Image.new('RGBA', (w, h), BG)  # 큰 타일/스플래시는 forest 배경
    side = int(min(w, h) * (ratio if ratio > 0 else 0.62))
    logo = src.resize((side, side), Image.LANCZOS)
    x = (w - side) // 2
    y = (h - side) // 2
    canvas.alpha_composite(logo, (x, y))
    canvas.save(os.path.join(OUT, name))
    return name, (w, h)

made = [make(n, *spec) for n, spec in ASSETS.items()]

for s in (16, 24, 32, 44, 48, 256):
    im = src.resize((s, s), Image.LANCZOS)
    for suffix in ('targetsize-%d' % s, 'targetsize-%d_altform-unplated' % s):
        n = 'Square44x44Logo.%s.png' % suffix
        im.save(os.path.join(OUT, n))
        made.append((n, (s, s)))

for n, sz in made:
    print(' ', n, sz)
print('appx 타일 %d개 생성 ->' % len(made), OUT)
