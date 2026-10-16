#!/usr/bin/env python3
"""Generate temporary placeholder SVGs with named parts for CSS animation."""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(ROOT, exist_ok=True)

HEADER = '''<!-- PLACEHOLDER: replace with Canva Pro export (same filename); keep data-part groups -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
'''

# Each value is inner SVG (groups with data-part)
ICONS = {
    'shopping-cart': '''
  <g data-part="cart-body"><path d="M4 7h16l-1.5 8H6L4 7z" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="wheels"><circle cx="9" cy="19" r="1.25" fill="currentColor"/><circle cx="17" cy="19" r="1.25" fill="currentColor"/></g>''',
    'utensils': '''
  <g data-part="fork"><path d="M8 4v8M8 14v6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></g>
  <g data-part="knife"><path d="M16 4v6a3 3 0 0 1-3 3M12 13v7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></g>''',
    'fuel': '''
  <g data-part="pump"><path d="M6 20V8l6-4v16M6 12h6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M14 10h4v10" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="nozzle"><path d="M16 10h2v3h-2" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="drop"><circle cx="17" cy="17" r="1" fill="currentColor"/></g>''',
    'receipt': '''
  <g data-part="paper"><path d="M7 4h10v16l-2-1.5L13 20l-2-1.5L9 20l-2-1.5L5 20V4z" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="lines"><path d="M9 8h6M9 12h6" stroke="currentColor" stroke-width="1.75"/></g>''',
    'ticket': '''
  <g data-part="popper"><path d="M5 8h14v8H5V8z" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="confetti">
    <circle data-part="cf1" cx="9" cy="7.5" r=".45" fill="currentColor"/>
    <circle data-part="cf2" cx="11.5" cy="6.8" r=".4" fill="currentColor"/>
    <circle data-part="cf3" cx="14" cy="7.5" r=".45" fill="currentColor"/>
    <circle data-part="cf4" cx="12" cy="8.2" r=".35" fill="currentColor"/>
  </g>''',
    'circle-dot': '''
  <g data-part="box"><path d="M6 9h12v10H6V9z" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="lid"><path d="M5 9h14l-1-3H6l-1 3z" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="dot"><circle cx="12" cy="14" r="1.5" fill="currentColor"/></g>''',
    'car': '''
  <g data-part="body"><path d="M5 16l1-5h12l1 5M7 16h10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></g>
  <g data-part="wheels"><circle cx="8" cy="17" r="1.25" fill="currentColor"/><circle cx="16" cy="17" r="1.25" fill="currentColor"/></g>''',
    'bag': '''
  <g data-part="strap"><path d="M9 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="bag"><path d="M6 8h12v12H6V8z" stroke="currentColor" stroke-width="1.75"/></g>''',
    'coffee': '''
  <g data-part="cup"><path d="M6 8h10v6a4 4 0 0 1-4 4H8a2 2 0 0 1-2-2V8z" stroke="currentColor" stroke-width="1.75"/><path d="M16 10h2a2 2 0 0 1 0 4h-2" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="steam"><path d="M9 5c0-1 .5-2 1-2s1 1 1 2M12 4c0-1 .5-2 1-2s1 1 1 2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></g>''',
    'home': '''
  <g data-part="house"><path d="M5 11V20h14V11M12 4l7 7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></g>
  <g data-part="window"><rect x="10" y="13" width="4" height="4" rx=".5" fill="currentColor" opacity=".35"/></g>''',
    'heart': '''
  <g data-part="heart"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z" stroke="currentColor" stroke-width="1.75"/></g>''',
    'plane': '''
  <g data-part="plane"><path d="M4 12l16-6-6 16-2-6-6-2z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></g>''',
    'gift': '''
  <g data-part="box"><path d="M5 11h14v9H5V11z" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="lid"><path d="M5 11V8h14v3M12 8v12" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="bow"><path d="M12 8c-2-3-4-3-4-1s2 2 4 1 4-2 4 0-2 2-4 0" stroke="currentColor" stroke-width="1.75"/></g>''',
    'phone': '''
  <g data-part="phone"><rect x="8" y="4" width="8" height="16" rx="2" stroke="currentColor" stroke-width="1.75"/></g>''',
    'wrench': '''
  <g data-part="wrench"><path d="M16 8a4 4 0 0 1-5.5 5.5L6 18l2 2 4.5-4.5A4 4 0 0 1 16 8z" stroke="currentColor" stroke-width="1.75"/></g>''',
    'gamepad': '''
  <g data-part="pad"><rect x="5" y="9" width="14" height="8" rx="3" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="buttons"><path d="M9 13v2M8 14h2M15 14h.01M17 13h.01" stroke="currentColor" stroke-width="1.75"/></g>''',
    'book': '''
  <g data-part="cover"><path d="M6 5h12v14H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.75"/></g>
  <g data-part="spine"><path d="M8 5v14" stroke="currentColor" stroke-width="1.75"/></g>''',
    'ui-note': '<g data-part="glyph"><path d="M8 4h8v16H8V4z" stroke="currentColor" stroke-width="1.75"/><path d="M10 8h4M10 12h4" stroke="currentColor" stroke-width="1.75"/></g>',
    'ui-calendar': '<g data-part="glyph"><rect x="4" y="6" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.75"/><path d="M8 4v4M16 4v4M4 10h16" stroke="currentColor" stroke-width="1.75"/></g>',
    'ui-camera': '<g data-part="glyph"><rect x="5" y="7" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.75"/><circle cx="12" cy="12.5" r="3" stroke="currentColor" stroke-width="1.75"/></g>',
    'ui-repeat': '<g data-part="glyph"><path d="M6 8h11a3 3 0 0 1 3 3v1M18 16H7a3 3 0 0 1-3-3v-1M6 5L4 8l3 1M18 19l2-3-3-1" stroke="currentColor" stroke-width="1.75"/></g>',
    'ui-search': '<g data-part="glyph"><circle cx="11" cy="11" r="5" stroke="currentColor" stroke-width="1.75"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.75"/></g>',
    'ui-sparkles': '<g data-part="glyph"><path d="M12 4l1 4 4 1-4 1-1 4-1-4-4-1 4-1 1-4zM5 6l.5 2 2 .5-2 .5L5 11l-.5-2-2-.5 2-.5L5 6z" fill="currentColor"/></g>',
    'ui-insight': '<g data-part="glyph"><path d="M12 3a6 6 0 0 0-3 11v3h6v-3A6 6 0 0 0 12 3z" stroke="currentColor" stroke-width="1.75"/><path d="M10 20h4" stroke="currentColor" stroke-width="1.75"/></g>',
    'ui-trend-up': '<g data-part="glyph"><path d="M4 18l6-6 4 4 6-8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M16 8h4v4" stroke="currentColor" stroke-width="1.75"/></g>',
    'ui-trend-down': '<g data-part="glyph"><path d="M4 8l6 6 4-4 6 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M16 16h4v-4" stroke="currentColor" stroke-width="1.75"/></g>',
    'ui-trend-flat': '<g data-part="glyph"><path d="M4 12h16" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></g>',
    'ui-alert': '<g data-part="glyph"><path d="M12 8v5M12 17h.01" stroke="currentColor" stroke-width="1.75"/><path d="M12 4l9 16H3L12 4z" stroke="currentColor" stroke-width="1.75"/></g>',
}

for name, body in sorted(ICONS.items()):
    with open(os.path.join(ROOT, name + '.svg'), 'w') as f:
        f.write(HEADER + body + '\n</svg>\n')

with open(os.path.join(ROOT, 'icons.json'), 'w') as f:
    json.dump(sorted(ICONS.keys()), f, indent=2)
    f.write('\n')
print('Wrote', len(ICONS), 'placeholder icons')
