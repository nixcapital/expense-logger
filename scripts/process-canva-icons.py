#!/usr/bin/env python3
"""Normalize Canva category SVGs into icons/*.svg with data-part groups."""
import json
import os
import re
import xml.etree.ElementTree as ET

SRC = os.path.join(os.path.dirname(__file__), '..', 'tmp', 'canva-src')
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')

FILE_TO_ID = {
    1: 'shopping-cart',
    2: 'utensils',
    3: 'fuel',
    4: 'receipt',
    5: 'ticket',
    6: 'boxes',
    7: 'car',
    8: 'home',
    9: 'health',
    10: 'bag',
    11: 'coffee',
    12: 'gift',
    13: 'plane',
    14: 'phone',
    15: 'pets',
    16: 'education',
}

OPTICAL = {
    'car': 1.2,
    'plane': 1.16,
    'ticket': 1.05,
    'shopping-cart': 1.06,
    'utensils': 1.04,
    'phone': 0.88,
    'pets': 0.9,
    'boxes': 0.92,
    'bag': 1.06,
    'home': 1.03,
}

SVG_NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG_NS)


def local(tag):
    return tag.split('}')[-1] if '}' in tag else tag


def first_point(d):
    m = re.search(r'[Mm]\s*([-\d.]+)[,\s]+([-\d.]+)', d)
    if not m:
        return None
    return float(m.group(1)), float(m.group(2))


def nums_from_path(d):
    return [float(x) for x in re.findall(r'[-]?\d*\.?\d+(?:e[-+]?\d+)?', d, re.I)]


def path_bbox(d):
    n = nums_from_path(d)
    if len(n) < 2:
        return None
    xs = n[0::2]
    ys = n[1::2]
    if not xs or not ys:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def merge_bbox(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])


def round_path(d, places=1):
    def repl(m):
        return str(round(float(m.group(0)), places))
    d = re.sub(r'[-]?\d*\.?\d+(?:e[-+]?\d+)?', repl, d, flags=re.I)
    d = re.sub(r'\s+Z\s+M\s+[-\d.]+\s+[-\d.]+\s+Z\s*$', ' Z', d)
    return d.strip()


def is_simple_rect_path(d):
    """Clip-path bbox rectangles (no curves)."""
    if re.search(r'[CcQqAa]', d):
        return False
    bb = path_bbox(d)
    if not bb:
        return False
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    if w < 8 or h < 8:
        return False
    # Mostly 4-segment rects from Canva clips
    segs = len(re.findall(r'\bL\b', d))
    return segs <= 5 and 'Z' in d


def collect_visible_paths(root):
    """Paths outside defs/clipPath only."""
    out = []

    def walk(node, skip=False):
        tag = local(node.tag)
        if tag == 'defs':
            return
        if tag == 'clipPath':
            return
        if tag == 'path':
            if not skip:
                d = node.get('d')
                if d and not is_simple_rect_path(d):
                    rule = node.get('fill-rule') or node.get('clip-rule') or 'nonzero'
                    if rule not in ('nonzero', 'evenodd'):
                        rule = 'nonzero'
                    out.append({'d': d, 'fill_rule': rule, 'pt': first_point(d)})
            return
        for ch in node:
            walk(ch, skip)

    walk(root)
    return out


def part_for_path(icon_id, pt, d, bbox):
    y = pt[1] if pt else 0
    x = pt[0] if pt else 0
    cy = (bbox[1] + bbox[3]) / 2 if bbox else y

    if icon_id == 'shopping-cart':
        if cy > 270 or (bbox and (bbox[3] - bbox[1]) < 50 and cy > 250):
            return 'wheels'
        return 'cart-body'
    if icon_id == 'utensils':
        return 'fork' if x < 192 else 'knife'
    if icon_id == 'fuel':
        if bbox and bbox[3] > 300 and x > 270:
            return 'drop'
        if x > 230:
            return 'nozzle'
        return 'pump'
    if icon_id == 'receipt':
        if bbox and (bbox[2] - bbox[0]) < 90 and 130 < x < 280 and 120 < y < 280:
            return 'bolt'
        if y < 130:
            return 'lines'
        return 'paper'
    if icon_id == 'ticket':
        return 'popper'
    if icon_id == 'boxes':
        return 'lid' if cy < 170 else 'box'
    if icon_id == 'car':
        if cy > 215 and bbox and (bbox[2] - bbox[0]) < 70:
            return 'wheels'
        return 'body'
    if icon_id == 'home':
        return 'window' if 120 < x < 270 and 130 < y < 280 else 'house'
    if icon_id == 'health':
        return 'stethoscope' if x > 200 else 'heart'
    if icon_id == 'bag':
        return 'strap' if cy < 140 else 'bag'
    if icon_id == 'coffee':
        return 'steam' if cy < 130 else 'cup'
    if icon_id == 'gift':
        return 'lid' if cy < 175 else 'box'
    if icon_id == 'plane':
        return 'plane'
    if icon_id == 'phone':
        if bbox and (bbox[2] - bbox[0]) < 180 and x > 190 and y < 220:
            return 'alert'
        return 'phone'
    if icon_id == 'pets':
        return 'ear' if x > 200 and y < 200 else 'head'
    if icon_id == 'education':
        return 'tassel' if x > 220 else 'cap'
    return 'glyph'


def ticket_skip_path(pt):
    if pt is None:
        return False
    x, y = pt
    return 155 < x < 295 and 165 < y < 225


def path_to_markup(p):
    d2 = round_path(p['d'])
    rule = p['fill_rule']
    return f'<path fill="currentColor" fill-rule="{rule}" d="{d2}"/>'


def build_confetti_dots():
    return (
        '<circle data-part="cf1" cx="11" cy="9.5" r="0.45" fill="currentColor"/>'
        '<circle data-part="cf2" cx="12.5" cy="8.8" r="0.4" fill="currentColor"/>'
        '<circle data-part="cf3" cx="14" cy="9.5" r="0.45" fill="currentColor"/>'
        '<circle data-part="cf4" cx="12" cy="10.2" r="0.35" fill="currentColor"/>'
    )


def process_file(num, icon_id):
    path = os.path.join(SRC, f'{num}.svg')
    root = ET.fromstring(open(path, encoding='utf-8').read())

    paths = collect_visible_paths(root)
    if icon_id == 'ticket':
        paths = [p for p in paths if not ticket_skip_path(p['pt'])]

    bbox = None
    for p in paths:
        bbox = merge_bbox(bbox, path_bbox(p['d']))
    if not bbox:
        bbox = (0, 0, 384, 384)

    minx, miny, maxx, maxy = bbox
    pad = max(maxx - minx, maxy - miny) * 0.08
    minx -= pad
    miny -= pad
    maxx += pad
    maxy += pad
    w = maxx - minx
    h = maxy - miny
    size = max(w, h)
    target = 20.0
    scale = (target / size) * OPTICAL.get(icon_id, 1.0)
    tx = 12 - (minx + w / 2) * scale
    ty = 12 - (miny + h / 2) * scale

    parts = {}
    for p in paths:
        bb = path_bbox(p['d'])
        part = part_for_path(icon_id, p['pt'], p['d'], bb)
        parts.setdefault(part, []).append(p)

    part_groups = []
    for part, plist in parts.items():
        inner = ''.join(path_to_markup(p) for p in plist)
        part_groups.append(f'<g data-part="{part}">{inner}</g>')

    confetti = f'\n  <g data-part="confetti">{build_confetti_dots()}</g>' if icon_id == 'ticket' else ''

    body = (
        f'<g transform="translate({tx:.3f},{ty:.3f}) scale({scale:.6f})">\n    '
        + '\n    '.join(part_groups)
        + '\n  </g>'
        + confetti
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">\n'
        f'  {body}\n'
        f'</svg>\n'
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    ids = []
    for num in range(1, 17):
        icon_id = FILE_TO_ID[num]
        svg = process_file(num, icon_id)
        out_path = os.path.join(OUT, f'{icon_id}.svg')
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(svg)
        ids.append(icon_id)
        print('wrote', icon_id, os.path.getsize(out_path), 'paths', svg.count('<path'))

    for alias, target in (('circle-dot', 'boxes'), ('heart', 'health')):
        data = open(os.path.join(OUT, f'{target}.svg')).read()
        with open(os.path.join(OUT, f'{alias}.svg'), 'w', encoding='utf-8') as f:
            f.write(data)

    ui_keep = [
        'ui-note', 'ui-calendar', 'ui-camera', 'ui-repeat', 'ui-search', 'ui-sparkles',
        'ui-insight', 'ui-trend-up', 'ui-trend-down', 'ui-trend-flat', 'ui-alert',
    ]
    for obsolete in ('wrench', 'gamepad', 'book'):
        p = os.path.join(OUT, f'{obsolete}.svg')
        if os.path.isfile(p):
            os.remove(p)

    manifest = sorted(set(ids + ui_keep + ['circle-dot', 'heart']))
    with open(os.path.join(OUT, 'icons.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main()
