#!/usr/bin/env python3
"""One-off generator for Expense Logger 1.3.0 icons (not shipped as app dependency)."""
from PIL import Image, ImageDraw
import math
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
BLUE = (91, 140, 255)
WHITE = (255, 255, 255)
BG = (11, 12, 16)


def draw_icon(size):
    img = Image.new('RGBA', (size, size), BG + (255,))
    d = ImageDraw.Draw(img)
    margin = int(size * 0.22)
    w = size - margin * 2
    h = int(w * 1.15)
    x0 = margin
    y0 = (size - h) // 2
    x1 = x0 + w
    y1 = y0 + h
    r = max(2, size // 32)
    # receipt body
    d.rounded_rectangle([x0, y0, x1, y1 - int(size * 0.06)], radius=r, fill=WHITE)
    # zig-zag bottom
    zig_h = int(size * 0.06)
    pts = []
    n = 5 if size >= 120 else 3
    for i in range(n + 1):
        xi = x0 + (w * i) / n
        yi = y1 if i % 2 == 0 else y1 - zig_h
        pts.append((xi, yi))
    pts.append((x1, y0 + h - zig_h))
    pts.append((x0, y0 + h - zig_h))
    d.polygon(pts, fill=WHITE)
    sw = max(2, size // 28)
    bar_y = y0 + int(h * 0.28)
    d.rounded_rectangle(
        [x0 + w * 0.22, bar_y, x1 - w * 0.22, bar_y + sw * 2],
        radius=sw,
        fill=BLUE,
    )
    # checkmark
    cx, cy = size // 2, y0 + int(h * 0.58)
    s = w * 0.22
    d.line(
        [(cx - s, cy), (cx - s * 0.2, cy + s * 0.85), (cx + s, cy - s * 0.65)],
        fill=BLUE,
        width=sw,
        joint='curve',
    )
    return img


def draw_splash_bg(size_w, size_h):
    img = Image.new('RGBA', (size_w, size_h), BG + (255,))
    d = ImageDraw.Draw(img)
    for i in range(80):
        t = i / 80
        c = int(BG[0] + (20 * (1 - t)))
        d.ellipse(
            [size_w // 2 - int(400 * t), size_h // 3 - int(400 * t),
             size_w // 2 + int(400 * t), size_h // 3 + int(400 * t)],
            outline=(c, c + 2, c + 8, 30),
        )
    return img


for name, sz in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)]:
    draw_icon(sz).save(os.path.join(ROOT, name), 'PNG')

# splash uses same icon centered (in-app splash is CSS; this is optional asset)
splash = draw_splash_bg(390, 844)
icon = draw_icon(120)
splash.paste(icon, ((390 - 120) // 2, 280), icon)
draw = ImageDraw.Draw(splash)
try:
    from PIL import ImageFont
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
    sub = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
except Exception:
    font = sub = None
if font:
    draw.text((195, 420), 'Expense Logger', fill=WHITE, font=font, anchor='mm')
    draw.text((195, 448), 'Quick entries, saved on this device', fill=(138, 145, 163), font=sub, anchor='mm')
splash.save(os.path.join(ROOT, 'splash-asset.png'), 'PNG')
print('Generated icons and splash-asset.png')
