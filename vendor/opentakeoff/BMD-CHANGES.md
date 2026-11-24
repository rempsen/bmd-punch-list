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
| new `web/src/lib/bmd/quantities.js` + test; `bmdStore.js`, `bmdApi.js` | Every save also sends the measured quantities (no waste, reviewed measurements only) per finish and area, worked out with OpenTakeoff's totals module | The BMD estimate reads them; finishes on the job are created from the takeoff |
| `web/src/pages/SimpleTakeoff.jsx`, `lib/bmd/takeoffDoc.js` | Rename and remove a finish, area names on measurements, this-sheet totals, a box for the known length, touch pan and pinch | Completing the simple screen |
| new `web/src/lib/bmd/drawings.js` + test; `web/src/pages/SimpleTakeoff.jsx`, `styles/simpleTakeoff.css` | Add drawings from the simple screen: drop PDFs anywhere or use "+ Add drawings"; they are filed under the project's Plans and open at once. The empty screen has the same button | Estimators start a takeoff without visiting Documents first |
| `web/src/lib/bmd/drawings.js`, `bmdApi.js`, `bmdStore.js`, `pages/SimpleTakeoff.jsx` | The sheet number read from each measured sheet's title block is saved to BMD Projects (`takeoff_sheet_labels`) | Quotes name their marked-up drawings ("A-101") without opening the PDF |
| new `web/src/lib/bmd/roomParts.js` + test; `web/src/lib/bmd/engine.js` | "Click a room" sorts the sheet's linework before filling: invisible ink (clipping outlines, the white boxes drawn behind notes), strokes inside text, tags and bubbles that their own text fills, arrowheads with their leaders, and dashed lines are left out of the mask OpenTakeoff fills against (through its existing `roles` argument). After the fill, enclosed areas along the room's edge that are shaped like cabinets or fixtures are found and returned (`fixtures`, `withFixtures`); a click inside one measures that fixture; a fill that wraps around other rooms is refused; the result carries a confidence and a plain note of what was ignored. BMD's own code, written for this; the fill, trace, snap and review score are still OpenTakeoff's functions, unchanged | Room tags, section bubbles, notes and arrows were carving notches out of rooms; flooring runs under markup. Cabinets are left out by default and offered back |
| `web/src/lib/oneclick.ts` (`extractVectorGeometry`, `VectorGeometry`) | Records, per segment, whether the PDF strokes it with a dash pattern (`dashed`), following the dash state through save/restore, forms, `setDash` and graphics-state dictionaries. Nothing upstream reads it | Dashed strokes are hidden or overhead lines, not walls; `roomParts.js` needs the fact and the extraction is where it is known |
| `web/src/lib/bmd/takeoffDoc.js` + test | `reshapeShape`: gives a measurement a new outline and measures it again | Including a room's cabinet areas replaces the room's outline in one undoable step |
| `web/src/pages/SimpleTakeoff.jsx`, `web/src/styles/simpleTakeoff.css` | After a room click the note says what was ignored inside the room; when cabinet or fixture areas were left out, a bar offers "Include them" | The estimator sees what the click decided and can put the cabinets in with one press |
