# Chrome Web Store — Listing Copy

Paste these into the Developer Dashboard fields.

## Name (≤ 75 chars)
Flight Grid Extender

## Summary (≤ 132 chars)
Expand the Google Flights price calendar into a 30×30 departure-by-return matrix. Compare a month of dates at a glance.

## Category
Travel

## Detailed description
See a full month of departure dates against a full month of return dates — in one
view. Google Flights' built-in price grid only shows a small window at a time. Flight
Grid Extender adds a "Show 30 days" button to the price-insights dialog that builds a
30×30 departure-by-return price matrix.

Features
• 30×30 grid of round-trip prices, fetched in parallel (a couple of seconds).
• Color coding: cheapest, low, normal, and high fares.
• Weekday labels with Friday/Saturday/Sunday highlighting.
• Pinned row/column headers so dates stay visible while you scroll.
• Click any price to rerun the search for that exact departure/return pair.

Privacy
Collects and transmits no user data. No analytics, no tracking, no remote code. It
only issues the same price requests to google.com that the page already makes.

Unofficial. Not affiliated with, endorsed by, or sponsored by Google. "Google
Flights" is a trademark of Google LLC.

## Single purpose (justification field)
The extension has one purpose: to display Google Flights round-trip prices for a
larger range of dates (a 30×30 departure/return matrix) than the site shows natively.

## Permission justifications
- Host access to `https://www.google.com/travel/flights`: The extension must run on Google Flights pages to
  read the price-calendar data already loaded there and to request additional dates
  in the same format. It does not access any other site.
- No other permissions are requested. No tabs, storage, cookies, or background
  permissions are used.

## Data usage disclosures (Privacy practices tab)
- Does NOT collect or use user data.
- Check: "I do not sell or transfer user data to third parties …" (all apply).
- Privacy policy URL: <host PRIVACY.md and paste the URL here>

---

# Store assets
- `store-assets/screenshot_1280x800.png`: selected-fare overview.
- `store-assets/screenshot_hover_1280x800.png`: departure/return hover-path behavior.
- `store-assets/promo_small_440x280.png`: small promo tile.
- `store-assets/promo_marquee_1400x560.png`: marquee promo tile.
- A publicly hosted privacy policy URL (e.g. GitHub repo's PRIVACY.md raw/Pages link).
