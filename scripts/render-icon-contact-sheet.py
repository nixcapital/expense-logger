#!/usr/bin/env python3
"""Render category icons contact sheet (34px art in 64px badge) for visual QA."""
import html
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
ICONS = os.path.join(ROOT, 'icons')
OUT_HTML = os.path.join(ROOT, 'el-icons', 'norm-contact.html')
OUT_README = os.path.join(ROOT, 'el-icons', 'norm-contact-readme.txt')

ORDER = [
    'shopping-cart', 'utensils', 'fuel', 'receipt', 'ticket', 'boxes', 'car', 'home',
    'health', 'bag', 'coffee', 'gift', 'plane', 'phone', 'pets', 'education',
]


def inner_svg(path):
    raw = open(path, encoding='utf-8').read()
    m = __import__('re').search(r'<svg[^>]*>([\s\S]*)</svg>', raw, __import__('re').I)
    return m.group(1).strip() if m else ''


def main():
    os.makedirs(os.path.dirname(OUT_HTML), exist_ok=True)
    cells = []
    for name in ORDER:
        p = os.path.join(ICONS, f'{name}.svg')
        inner = inner_svg(p)
        cells.append(
            f'<div class="cell"><div class="badge" style="--fg:#3b6fd9">'
            f'<svg class="art" viewBox="0 0 24 24" fill="none" width="34" height="34">{inner}</svg>'
            f'</div><span class="lbl">{html.escape(name)}</span></div>'
        )

    doc = f'''<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="../icon-animations.css?v=1.3.0">
<style>
  body {{ background: #f2f3f7; color: #111; font: 12px system-ui; padding: 24px; }}
  .grid {{ display: grid; grid-template-columns: repeat(8, 72px); gap: 16px; max-width: 640px; }}
  .cell {{ text-align: center; }}
  .badge {{
    width: 64px; height: 64px; margin: 0 auto 6px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--fg) 18%, #fff);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }}
  .art {{ color: var(--fg); display: block; }}
  .lbl {{ font-size: 9px; color: #555; word-break: break-all; }}
</style></head><body>
<h1>Normalized icons (34px in 64px badge)</h1>
<div class="grid">{"".join(cells)}</div>
</body></html>'''
    with open(OUT_HTML, 'w', encoding='utf-8') as f:
        f.write(doc)
    with open(OUT_README, 'w') as f:
        f.write('Open norm-contact.html in browser or screenshot to el-icons/norm-contact.png\n')
    print('wrote', OUT_HTML)


if __name__ == '__main__':
    main()
