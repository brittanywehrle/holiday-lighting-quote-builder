# Wehrle Quote Builder

Internal quoting tool for **Wehrle Holiday Lighting** (tagline: *Firefighter Owned & Operated*). The two owners use it on an iPad to quote holiday light installs:

1. Upload a daytime photo of a house.
2. Set the scale from a known object (usually a 16 ft garage door).
3. Trace C9 lines, garland and wreath positions, plus windows to light up.
4. Preview a dusk mockup (warm white or multicolor).
5. Price the job and produce a branded PDF proposal to text or email to the customer.

It is **not** customer-facing. Customers only ever see the PDF.

## How it's built

- A static site with no build step: `index.html` + `styles.css` + `app.js` (plain JavaScript, no framework). Edit the files and deploy.
- Hosting: Cloudflare Pages, auto-deploying from `main`, at `quote.<domain>`. It is protected by Cloudflare Access (only the owners' emails can open it).
- Installed on iPads with Safari's **Add to Home Screen** (`manifest.webmanifest`, `icons/`). `sw.js` makes it work offline: network first, cached fallback.
- All data lives **on each device** in IndexedDB. There is no server or database yet. Devices don't sync; **Back up all jobs** and **Restore backup** on the Jobs tab move data between devices.
- Photos are stored as JPEG **data URLs (strings), never Blobs**. iPad Safari failed to display Blobs read back from IndexedDB, so keep it this way.
- Vendored, self-hosted dependencies so it works offline: `vendor/jspdf.umd.min.js` (2.5.1), `vendor/exceljs.min.js` (4.4.0, loaded only when exporting), `vendor/pdf.min.js` + `vendor/pdf.worker.min.js` (PDF.js 3.11.174 legacy build, loaded only when reading a Roofr report), and `fonts/` (Noto Sans 400/400i/600/700, Noto Serif 800).
- Saving files: on touch devices, `offerFile()` opens the iOS share sheet (`navigator.share`). Elsewhere it triggers a normal download. iOS only allows the share sheet right after a tap, so if file prep is slow a "Ready to share" bar appears and the next tap shares it. Proposal PDF/PNG blobs are pre-built after the proposal renders for the same reason.

## Code map (`app.js`, top to bottom)

| Section | What it does |
| --- | --- |
| helpers | `$`, `esc`, `uid`, `money`, geometry |
| `Store` | IndexedDB adapter: `jobs`, `photos`, `kv` stores, with an in-memory fallback. **The only place that touches storage**, so it can be swapped for a cloud DB later. |
| settings | `defaultSettings()`, `mergeSettings()` (also migrates old saved settings) |
| options | `normalizeJob()` migrates older job shapes; `cur()`, `viewOf(job, opt)`, `allShapes()` |
| pricing | `measure()`, `computeQuote(view, settings)`, the single source of truth for every price |
| rendering | dusk grade (`duskBase`, `duskWithWindows`), bulbs, garland, wreath, `renderScene`, `renderMockup` |
| trace editor | canvas, pointer/pinch gestures, tools, undo history, options panel |
| photos | resize to max 2000px, data URLs, sample-house fallback |
| views | jobs list, quote, proposal, settings |
| Roofr report | `pdfText()` (PDF.js text by line), `parseRoofr()` (edge lengths, pitch, area, address), `renderRoofrCard()` on the Quote tab |
| Excel tracker | `exportTracker()`: one row per job (sample excluded), option names/prices side by side, Status dropdown |
| Google Sheet sync | `Sheet` module: queue, `flush()`, `syncAll()`; wraps `Store.saveJob`/`deleteJob` |
| proposal | canvas-drawn letter pages at 1700×2200 → jsPDF |

## Data model

```
job: { id, customer{name,address,phone,email}, status, photoId, photoW, photoH,
       scale{a,b,feet}, spacing (12|15), color ('warm'|'multi'),
       windows: [shape],                     // shared by all options
       options: [{ id, name, shapes: [shape], siteC9, siteGarland, custom: [{desc,amount,future}],
                  future: { c9, garland, wreaths, 'fee:<id>': amount } }],   // write-in future-season prices
       activeOpt, renderings{ '<optId>:<warm|multi>': photoId },
       quote{ newCustomer, rate, buffer, fees{}, wreathMarkup, garlandMarkup,
              garlandCost, garlandLen, mockups ('both'|'warm'|'multi'), snapshot },
       roofr: null | { file, at, address, pitch, area, measures{eaves,rakes,ridges,hips,valleys,…: feet}, pick{edge: bool} },
       proposalNo, status, sentAt }
status: 'draft'|'sent'|'approved'|'scheduled'|'completed'|'declined'  (older values are migrated in normalizeJob)
shape: { id, type: 'c9'|'garland'|'wreath'|'window', points:[{x,y}] (photo pixels), size, cost, lit }
```

Always compute prices with `computeQuote(viewOf(job, option), S.settings)`. `viewOf` merges the shared windows and the option's shapes and site measurements into one object.

## Pricing rules (owner-approved, don't change without asking)

- **C9 lights:** $7 per linear foot (Settings), which covers install, takedown and storage. Customers **lease** the lights.
- **New customer startup fee:** $349, toggled per job. Returning customers don't pay it. It is also the deposit due at signing.
- **Measurement buffer:** +10% on photo-measured C9 and garland feet (Settings, overridable per job). The customer sees only the buffered number.
- **Measured on site:** a per-option override for C9 and garland feet, used as-is with **no buffer**.
- **Wreaths:** item cost × markup (default 2×). **Garland:** whole strands × strand cost × markup (default 2×). The markups are separate and editable in Settings and per job. Both are part of the install, not the startup fee.
- **Extra fees:** a list in Settings (per-foot or flat), each a switch on the quote. There is **no 2-story surcharge** (the owners decided against it).
- **No minimum job charge.**
- **Future seasons:** each line repeats at this season's price unless the owners write in a future-season price for that line (Quote tab, "Future seasons" card, per option). Typical use: wreaths and garland drop the materials cost after year one. The startup fee never repeats. `computeQuote` returns `futureTotal`.
- Saving a proposal **locks the rates** for that job (`quote.snapshot`), so later Settings changes don't alter a sent quote.
- **Proposal numbers** come from Settings (`nextProposalNo`, starting at 31), are assigned once per job, and increment by one. They're for internal tracking (Excel, Google Sheet) and are **not printed on the PDF** (the owners removed them).

## Roofr reports

- For jobs that can't be measured in person or have a lot of roofline, the owners upload a **Roofr** roof report PDF on the Quote tab. The app reads the edge lengths (eaves, rakes, ridges, hips, valleys, flashing…), pitch, roof area and address. Only those numbers are saved on the job, never the PDF.
- Roofr totals cover the **whole roof**, so the owners tick the edges they're lighting (eaves + rakes by default). **Use N ft for C9 lights** puts that footage into the current option's Measured on site C9 box, priced with **no buffer**, and they can trim it there.
- A warning shows if the report's house number doesn't match the job address. Unreadable files show a message and change nothing.
- `samples/` (git-ignored) is for local test reports, since they contain customer addresses.

## Job tracking & Excel export

- **Statuses:** Draft, Sent, Approved, Scheduled, Completed, Declined. You set them on the Jobs tab. Sharing a proposal moves a Draft to Sent and records `sentAt`.
- **Export to Excel** (Jobs tab) builds `Wehrle Jobs Tracker YYYY-MM-DD.xlsx` with these columns: Proposal #, Customer, Address, Phone, Email, Status (dropdown), Created, Date sent, New customer, Startup fee, then Option N and Option N price for each option.
- **The app is the source of truth.** Excel is a backup snapshot (the live copy is the Google Sheet, below) that you re-export when you want a fresh copy. Status changes made in Excel do not flow back.

## Google Sheet sync

- **One-way, app is master.** Every `Store.saveJob` / `Store.deleteJob` (wrapped right after the `Sheet` module in `app.js`) queues that job; the sample job is skipped. The queue lives in IndexedDB (`kv.sheetQueue`) and is posted, batched and debounced about 4 s, to the Apps Script Web app URL in Settings (`settings.sheetUrl`).
- The body is sent as plain text on purpose: that keeps the request "simple" so the browser skips a CORS preflight, which Apps Script can't answer. The script replies with JSON `{ ok, error }`.
- Offline or failed sends stay queued and retry on `online`, on reopening the app, and every 60 s after a failure. A warning shows on the Jobs tab while it's behind; Settings shows status and a **Sync all jobs now** button (also runs when the link is first pasted).
- Sheet side: `google-sheet/sync.gs`, pasted into the sheet's Apps Script and deployed as a Web app (Execute as Me, access Anyone). Owned by the Google account samuel.w.wehrle@gmail.com. It upserts by a hidden **Job ID** column, appends new columns (e.g. Option 3) on the right, blanks options a job no longer has, removes rows for deleted jobs, and formats money, dates, phone and the Status dropdown.
- Columns: Job ID (hidden), Proposal #, Customer, Address, Phone, Email, Status, Created, Date sent, New customer, Startup fee, Last updated, then Option N / Option N price. Dates are sent as the iPad's local `YYYY-MM-DD[ HH:MM]` so the sheet's time zone doesn't shift them.
- If `sync.gs` changes, the owner must redeploy: Deploy → Manage deployments → edit → Version: New version (the URL stays the same).

## Proposal layout (owner-approved wording)

- **Option pages:** page 1 has the full header (logo, date, "Valid for 30 days", "Prepared for"; no proposal number). Later option pages and the terms page use a compact header with the company and customer name. Each page shows the mockups (warm white and/or multicolor, or an uploaded AI rendering), the line items, then this line: *"Includes lighting lease, professional installation, timer setup, in-season light maintenance, takedown and storage."*
- **Totals:** **Total for current season**, then italic **Total for future seasons** (`futureTotal`: the written-in future prices, or each line's current price when blank; never the startup fee).
- **Green box:** "Due at signing: $349 startup fee to secure your install date." / "The remaining balance is due once installation is complete."
- **Last page:** the terms (from Settings), a Customer Responsibilities paragraph, then acceptance. With several options it has a checkbox per option and its total.

## Brand

- **Colors:** red `#C1121F`, green `#1B5E3B`, gold `#D4A537`, warm white bulbs `#FFD58A`, black text `#111`.
- **Type:** Noto Serif 800 for "WEHRLE" and headings, Noto Sans for everything else (the owners chose these).
- **Logo:** `assets/logo.png` (transparent PNG: a dark green roofline with C9 bulbs, "WEHRLE", "HOLIDAY LIGHTING" in red, and the tagline). It's used at the top of proposal page 1; `drawLogo()` is only a fallback if the image fails to load. The icons in `icons/` are the roofline and "WEHRLE" cropped from it, on white.

## Working on it

- Run it locally: `python3 -m http.server 8000`, then open `http://localhost:8000`. The service worker registers on localhost too; use a private window to avoid stale caches.
- Primary device: **iPad, landscape, Apple Pencil or finger**. Keep touch targets 44px or larger. Test at phone width too.
- `alert`/`confirm`/`prompt` aren't used; confirmations are inline ("Delete for good" / "Keep").
- Keep saved data backward compatible. Old jobs are migrated in `normalizeJob()` and old settings in `mergeSettings()`.
- Deploy: push to `main`, and Cloudflare Pages publishes in about a minute. No build command; the output directory is the repo root.

## Roadmap (agreed, not built)

- Website contact-form leads flow into a **New leads** list in the app. The plan: the website Worker saves form submissions to a shared Cloudflare D1 database, and the app reads them. Deferred until lead volume justifies it.

- Sync jobs between devices (move `Store` to a cloud DB, such as Cloudflare D1/R2 or Supabase).
- Automatic AI night renderings through a Cloudflare Pages Function, so the API key stays server-side.
- Customer-facing proposal links instead of PDF attachments.
- A "reload last year's job" button for returning customers.
