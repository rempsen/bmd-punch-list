# Changes made by BMD Materials

This folder holds the `web/` application of OpenTakeoff at tag `apache-2.0-final`
(commit `84c7f48e`, 10 October 2026), licensed under the Apache License 2.0.
See `LICENSE`, `NOTICE` and `THIRD-PARTY-NOTICES.md`. No code from later
OpenTakeoff commits, which are under AGPL-3.0, is included.

Left out of this copy: `web/test/`, `web/bench/`, `web/review/` (the upstream test
fixtures and benchmarks; about 10 MB that the BMD build does not use).

Every change is marked in the source with a `// BMD change:` comment.

| File | Change | Why |
|---|---|---|
| `web/vite.config.js` | `base` set to `/takeoff/`; output folder set to the BMD app's `public/takeoff` | The workspace is served from inside the BMD Projects site |
| `web/index.html` | Replaced. Removed the upstream site's search and social tags, the Cloudflare Web Analytics beacon, the Netlify sign-up form and links to the upstream site's privacy, terms and llms.txt pages; added `noindex` and `no-referrer`; title set to "Takeoff · BMD Projects" | A private tool: no visitor analytics or third-party form posts, and not for search engines |
| `web/public/` | Removed `_headers`, `googlec4381fb3b0fbe628.html`, `legal.css`, `llms.txt`, `og-card.png`, `privacy/`, `terms/`, `robots.txt`, `sitemap.xml` | Upstream's own public-website files |
| `web/vite.config.js`, new `web/src/lib/bmd/noVoice.js` | `@huggingface/transformers` is aliased to a stand-in that throws | Voice dictation is not part of the BMD build; this keeps its library and speech models out of what is served |
| new `web/src/lib/bmd/bmdStore.js`, `bmdApi.js`, `bmdClient.js`, `bmdCache.js`, `flag.js`, tests | The BMD store: drawings from the project's documents, the takeoff saved as a versioned record in BMD Projects, company libraries, project snapshots | Takeoffs are kept in BMD Projects, not in one browser |
| new `web/src/components/BmdGate.jsx`, `BmdBanner.jsx` | Checks the BMD sign-in and project access before the canvas mounts; reports save failures, conflicts and recovered work | Access control and no silent loss of work |
| `web/src/main.jsx` | In the BMD build every visit goes through `BmdGate`; imports `styles/bmd-theme.css` and sets `<html data-bmd>` | No anonymous browser-only workspace |
| `web/vite.config.js` | `envDir` points at the BMD repository root | The BMD address and public key come from BMD's own `.env` |
| `web/package.json` | Added `@supabase/supabase-js` | Talking to BMD Projects |
| new `web/src/styles/bmd-theme.css` | Hides `[data-premium-trigger]` and `[data-bmd-hide]`; BMD accent colours | BMD look; hides what BMD replaces |
| `web/src/styles/tokens.css` | Google Fonts `@import` commented out | The workspace contacts no outside service |
| `web/src/components/WorkspaceChrome.jsx` | Brand reads "BMD Takeoff · Built on OpenTakeoff"; "Premium workspace" label replaced | BMD name with the credit kept visible |
| `web/src/components/PlanNavigator.jsx` | Empty-state wording; folder sync, sample plan, guided tour, Connect-your-AI, Clear workspace and Remove selected marked `data-bmd-hide`; `loadSample` does nothing in the BMD build | Sample data must not be filed on a real project; BMD documents are removed in BMD Documents only |
| `web/src/pages/TakeoffCanvas.jsx` | Status bar reads "BMD Projects"; the premium command is left out; `loadSampleForTour` does nothing in the BMD build | As above |
| new `web/src/pages/SimpleTakeoff.jsx`, `web/src/styles/simpleTakeoff.css` | The simple BMD takeoff screen: sheets, the drawing, and a plain "Measuring" list, with six tools (Select, Click a room, Draw area, Line, Count, Cut out) | BMD's own, simpler design; it is the screen people see first |
| new `web/src/lib/bmd/engine.js`, `takeoffDoc.js`, `view.js`, `feet.js`, tests, `fixtures/four-rooms.pdf` | A small interface over OpenTakeoff's own scale reading, room finding, tracing, snapping and measuring, and over its takeoff document format | The simple screen measures with OpenTakeoff's engine and saves OpenTakeoff's document, so the same takeoff opens in both screens |
| `web/src/components/BmdGate.jsx`, `web/src/main.jsx` | The simple screen is shown by default; `?view=advanced` shows the OpenTakeoff workspace | The full workspace stays available under "More tools" |
| `web/src/components/WorkspaceChrome.jsx`, `web/src/styles/bmd-theme.css` | "← Simple view" link beside the brand | The way back from the full workspace |
