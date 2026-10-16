#!/usr/bin/env python3
"""Resize Tri's chosen app icon (1024) to shipped PNG sizes. Dev-only; not a runtime dependency."""
from PIL import Image, ImageFilter, ImageEnhance
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.environ.get(
    'EL_ICON_SRC',
    os.path.join(ROOT, 'brand', 'icon-option-3.png'),
)

BG = (11, 12, 16)  # #0B0C10 — flatten alpha if present


def load_rgb(path):
    img = Image.open(path)
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        img = img.convert('RGBA')
        base = Image.new('RGB', img.size, BG)
        base.paste(img, mask=img.split()[3])
        return base
    return img.convert('RGB')


def save_size(img, size, path, sharpen=False):
    out = img.resize((size, size), Image.Resampling.LANCZOS)
    if sharpen:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.8, percent=90, threshold=2))
        out = ImageEnhance.Contrast(out).enhance(1.05)
    out.save(path, 'PNG', optimize=True)


def main():
    if not os.path.isfile(SRC):
        raise SystemExit('Icon source not found: ' + SRC)
    img = load_rgb(SRC)
    if img.size != (1024, 1024):
        print('Note: expected 1024x1024, got', img.size)
    save_size(img, 512, os.path.join(ROOT, 'icon-512.png'))
    save_size(img, 192, os.path.join(ROOT, 'icon-192.png'))
    save_size(img, 180, os.path.join(ROOT, 'apple-touch-icon.png'), sharpen=True)
    print('Generated icon-512.png, icon-192.png, apple-touch-icon.png from', SRC)


if __name__ == '__main__':
    main()
