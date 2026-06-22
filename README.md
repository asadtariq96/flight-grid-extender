# Flight Grid Extender

Expands the Google Flights price calendar (natively a 7×7 grid) into a **30×30
departure-by-return price matrix**, so you can compare a month of departure dates
against a month of return dates at a glance.

> Unofficial. Not affiliated with, endorsed by, or sponsored by Google.

## How it works

Google Flights renders only a small price grid at a time and fetches data lazily.
This extension:

1. Observes the page's own price-calendar request (`GetCalendarGrid`) to learn the
   current route, dates, and request format.
2. Replays that request **in parallel** (one call per return date, with concurrency
   limiting + retries), assembling a full 30×30 matrix in a couple of seconds — no
   slow UI scraping or clicking.
3. Renders the matrix as an overlay with:
   - color coding (cheapest / low / normal / high),
   - weekday labels with Fri/Sat/Sun highlighting,
   - pinned headers,
   - click-to-search: clicking a cell reruns Google's search for that exact
     departure/return pair.

The grid is triangular where appropriate — cells whose departure falls after the
return aren't real round trips and show `—`.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest (works on Chrome and Firefox 109+) |
| `content.js` | Isolated-world script: UI, overlay, click-through, bridge |
| `injected.js` | Page-context script: intercepts + replays the price RPC |
| `icons/` | 16 / 48 / 128 px icons |

No background/service worker, no remote code, no `eval`. All network requests go to
the same `www.google.com` origin the user is already on.

## Install (development)

**Chrome:** `chrome://extensions` → enable Developer mode → *Load unpacked* → select
this folder.

**Firefox:** `about:debugging` → This Firefox → *Load Temporary Add-on* → select
`manifest.json`.

## Privacy

Collects and transmits **no** user data. See `PRIVACY.md`.
