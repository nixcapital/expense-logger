# Category & UI icons

SVG (or PNG) artwork for Expense Logger lives here. **Current files are temporary placeholders** — replace them with Tri’s Canva Pro exports (same filenames).

- Prefer **SVG** with a single-color silhouette suitable for CSS `mask-image` (opaque shapes; the app tints via `currentColor` / category color).
- Keep **24×24** (or square) viewBox; ~1.75px stroke weight if line art.
- Filename = icon id (e.g. `shopping-cart.svg`, `ui-note.svg`).

Manifest: `icons.json` lists every file the app and service worker precache.
