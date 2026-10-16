#!/usr/bin/env python3
"""Normalize Canva category SVGs into icons/*.svg with data-part groups."""
import json
import os
import re
import xml.etree.ElementTree as ET

SRC = os.path.join(os.path.dirname(__file__), '..', 'tmp', 'canva-src')
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')

# Canva file number -> app icon id
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

# Extra optical scale after bbox fit (thin icons up, heavy down)
OPTICAL = {
    'car': 1.18,
    'plane': 1.14,
    'ticket': 1.06,
    'shopping-cart': 1.04,
    'utensils': 1.03,
    'phone': 0.86,
    'pets': 0.88,
    'boxes': 0.9,
    'bag': 1.05,
    'home': 1.02,
}

STROKE_BOOST = {'car', 'plane', 'ticket', 'shopping-cart'}

SVG_NS = 'http://www.w3.org/2000/svg'
XLINK_NS = 'http://www.w3.org/1999/xlink'
ET.register_namespace('', SVG_NS)
ET.register_namespace('xlink', XLINK_NS)


def local(tag):
    return tag.split('}')[-1] if '}' in tag else tag


def nums_from_path(d):
    return [float(x) for x in re.findall(r'[-]?\d*\.?\d+(?:e[-+]?\d+)?', d, re.I)]


def first_point(d):
    m = re.search(r'[Mm]\s*([-\d.]+)[,\s]+([-\d.]+)', d)
    if not m:
        return None
    return float(m.group(1)), float(m.group(2))


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
    # Drop Canva duplicate close segments
    d = re.sub(r'\s+Z\s+M\s+[-\d.]+\s+[-\d.]+\s+Z\s*$', ' Z', d)
    return d.strip()


def clean_element(el, icon_id, clip_map):
    tag = local(el.tag)
    if tag == 'defs':
        return None
    if tag == 'clipPath':
        return None
    if tag in ('metadata', 'title', 'desc'):
        return None

    if tag == 'path':
        d = el.get('d')
        if not d:
            return None
        # clip-only bbox rects inside clipped groups are huge — skip thin frame paths
        bb = path_bbox(d)
        if bb and (bb[2] - bb[0]) > 250 and (bb[3] - bb[1]) > 150 and d.strip().startswith('M') and 'C' not in d and 'c' not in d:
            if re.match(r'^M\s*[\d.]+\s+[\d.]+\s+L\s*[\d.]+\s+[\d.]+\s+L', d):
                return None
        el.set('fill', 'currentColor')
        for k in list(el.attrib):
            if k in ('fill-opacity', 'stroke', 'stroke-width', 'style', 'class'):
                del el.attrib[k]
        if icon_id in STROKE_BOOST:
            el.set('stroke', 'currentColor')
            el.set('stroke-width', '4')
            el.set('stroke-linejoin', 'round')
            el.set('paint-order', 'stroke fill')
        el.set('d', round_path(d))
        return el

    if tag == 'g':
        cp = el.get('clip-path') or el.get(f'{{{SVG_NS}}}clip-path')
        if cp and cp.startswith('url(#') and cp[5:-1] in clip_map:
            el.set('clip-path', f'url(#{clip_map[cp[5:-1]]})')
        kids = []
        for child in list(el):
            c = clean_element(child, icon_id, clip_map)
            if c is not None:
                kids.append(c)
        if not kids and not list(el):
            return None
        el[:] = kids
        return el

    return None


def collect_paths(root, icon_id, clip_map):
    items = []

    def walk(node, inherited_clip=None):
        tag = local(node.tag)
        if tag == 'defs':
            return
        clip = node.get('clip-path') or node.get(f'{{{SVG_NS}}}clip-path') or inherited_clip
        if tag == 'path':
            d = node.get('d')
            if d:
                items.append({'d': d, 'el': node, 'clip': clip, 'pt': first_point(d)})
            return
        for ch in node:
            walk(ch, clip)

    walk(root)
    return items


def part_for_index(icon_id, idx, pt, d):
    """Return data-part name for path index."""
    y = pt[1] if pt else 0
    x = pt[0] if pt else 0

    if icon_id == 'shopping-cart':
        if y > 265 or idx in (1, 2, 9, 10, 11):
            return 'wheels'
        return 'cart-body'
    if icon_id == 'utensils':
        return 'fork' if x < 192 else 'knife'
    if icon_id == 'fuel':
        if y > 250 and x > 280:
            return 'drop'
        if x > 240:
            return 'nozzle'
        return 'pump'
    if icon_id == 'receipt':
        if 'bolt' in d.lower() or (180 < x < 260 and 140 < y < 240):
            return 'bolt'
        if y < 120:
            return 'lines'
        return 'paper'
    if icon_id == 'ticket':
        return 'popper'
    if icon_id == 'boxes':
        return 'lid' if y < 150 else 'box'
    if icon_id == 'car':
        if y > 235 or idx in (0, 1, 6, 7, 8, 9):
            return 'wheels'
        return 'body'
    if icon_id == 'home':
        return 'window' if 130 < x < 250 and 150 < y < 260 else 'house'
    if icon_id == 'health':
        return 'stethoscope' if x > 200 else 'heart'
    if icon_id == 'bag':
        return 'strap' if y < 130 else 'bag'
    if icon_id == 'coffee':
        return 'steam' if y < 120 else 'cup'
    if icon_id == 'gift':
        return 'lid' if y < 175 else 'box'
    if icon_id == 'plane':
        return 'plane'
    if icon_id == 'phone':
        return 'alert' if x > 200 and y < 200 else 'phone'
    if icon_id == 'pets':
        return 'ear' if x > 200 and y < 200 else 'head'
    if icon_id == 'education':
        return 'tassel' if x > 230 else 'cap'
    return 'glyph'


def ticket_skip_index(idx, pt):
    """Drop TICKET letter paths (center band)."""
    if pt is None:
        return False
    x, y = pt
    return 155 < x < 295 and 165 < y < 225 and idx >= 7


def build_confetti_dots():
    return (
        '<circle data-part="cf1" cx="11" cy="9.5" r="0.45" fill="currentColor"/>'
        '<circle data-part="cf2" cx="12.5" cy="8.8" r="0.4" fill="currentColor"/>'
        '<circle data-part="cf3" cx="14" cy="9.5" r="0.45" fill="currentColor"/>'
        '<circle data-part="cf4" cx="12" cy="10.2" r="0.35" fill="currentColor"/>'
    )


def process_file(num, icon_id):
    path = os.path.join(SRC, f'{num}.svg')
    raw = open(path, encoding='utf-8').read()
    root = ET.fromstring(raw)

    clip_map = {}
    defs = root.find(f'{{{SVG_NS}}}defs')
    if defs is not None:
        for i, cp in enumerate(defs.findall(f'{{{SVG_NS}}}clipPath')):
            old = cp.get('id')
            if old:
                clip_map[old] = f'clip-{icon_id}-{i}'

    # flatten paths with indices
    paths = []
    idx = 0
    for el in root.iter():
        if local(el.tag) != 'path' or el.get('d') is None:
            continue
        d = el.get('d')
        pt = first_point(d)
        if ticket_skip_index(idx, pt) and icon_id == 'ticket':
            idx += 1
            continue
        paths.append((idx, d, pt))
        idx += 1

    bbox = None
    for _, d, _ in paths:
        bbox = merge_bbox(bbox, path_bbox(d))
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
    for i, d, pt in paths:
        part = part_for_index(icon_id, i, pt, d)
        parts.setdefault(part, []).append(d)

    part_groups = []
    for part, ds in parts.items():
        inner = ''
        for d in ds:
            d2 = round_path(d)
            stroke_attrs = ''
            if icon_id in STROKE_BOOST:
                stroke_attrs = ' stroke="currentColor" stroke-width="4" stroke-linejoin="round" paint-order="stroke fill"'
            inner += f'<path fill="currentColor"{stroke_attrs} d="{d2}"/>'
        part_groups.append(f'<g data-part="{part}">{inner}</g>')

    confetti = f'\n  <g data-part="confetti">{build_confetti_dots()}</g>' if icon_id == 'ticket' else ''

    body = (
        f'<g transform="translate({tx:.3f},{ty:.3f}) scale({scale:.6f})">\n    '
        + '\n    '.join(part_groups)
        + '\n  </g>'
        + confetti
    )
    out = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">\n'
        f'  {body}\n'
        f'</svg>\n'
    )
    return out


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
        print('wrote', icon_id, os.path.getsize(out_path))

    # Back-compat aliases
    for alias, target in (('circle-dot', 'boxes'), ('heart', 'health')):
        data = open(os.path.join(OUT, f'{target}.svg')).read()
        with open(os.path.join(OUT, f'{alias}.svg'), 'w', encoding='utf-8') as f:
            f.write(data)
        if alias not in ids:
            ids.append(alias)

    # Keep UI icons from placeholders if missing
    ui_keep = [
        'ui-note', 'ui-calendar', 'ui-camera', 'ui-repeat', 'ui-search', 'ui-sparkles',
        'ui-insight', 'ui-trend-up', 'ui-trend-down', 'ui-trend-flat', 'ui-alert',
    ]
    for uid in ui_keep:
        if uid not in ids:
            ids.append(uid)

    # Remove obsolete category placeholders
    for obsolete in ('wrench', 'gamepad', 'book'):
        p = os.path.join(OUT, f'{obsolete}.svg')
        if os.path.isfile(p):
            os.remove(p)

    manifest = sorted(set(ids + ui_keep))
    with open(os.path.join(OUT, 'icons.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main()
