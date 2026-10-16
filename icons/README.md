# Category & UI icons

Artwork for Expense Logger lives here. **Category icons** are Tri’s Canva Pro exports (processed into 24×24 SVG with `data-part` groups for micro-animations).

- Filled paths use **`currentColor`** so category tint applies in badges.
- Filename = icon id (e.g. `shopping-cart.svg`, `ui-note.svg`).
- Manifest: `icons.json` (service worker precache).

To re-import from Canva numbered exports (`1.svg`–`16.svg`), run:

`python3 scripts/process-canva-icons.py`
