# Scope keyword detection — 24 Nov 2026

## Rule (Dan)
Every plan and specification uploaded to any project — existing or new — is searched for BMD's scope terms or close variants, and every hit is surfaced in the project's Documents area for BMD estimators to review. This is how BMD identifies where it has scope.

## Keyword list (group)
- carpet: carpet, carpet tile, broadloom carpet, carpet base
- wall_base: rubber base, wall base, millwork base, rigid wall base, resilient base, resilient wall base
- vinyl: luxury vinyl tile, luxury vinyl plank, LVT*, LVP*, loose-lay plank, glue-down plank, vinyl click plank, vinyl click tile
- sheet_safety: sheet vinyl, SV*, safety floor, SF*
- rubber: rubber tile, rubber flooring, gym floor
- window_coverings: draperies, window coverings, roller shades, blinds, motorized shades, motorized blinds
- tile: tile, wall tile, backsplash, backsplash tile, accent tile, ceramic tile, porcelain tile, quarry tile, CT*, kitchen tile, entrance tile, Schluter
- kitchen_entrance: kitchen floor, entrance matting
- laminate: laminate, laminate flooring, SPC flooring, WPC flooring
- stairs_transitions: stair nosings, floor transitions, warning tile, tactile tiles, grip tape, stair treads
- wet_areas: shower floor, shower drain, shower waterproofing
- other: exterior decking, DuraDeck, hardwood flooring

\* whole word. The list lives in `scope_keywords` and is edited in Company settings → Scope keywords.

## Where it runs
- Migration `0076_scope_keywords` (tables `scope_keywords`, `document_scope_hits`, `scope_scan_state`).
- `src/lib/documents/scope-keywords.ts` — pure matcher `findScopeHits`, tested.
- After a document's text is stored (`storeDocumentText`), the server replaces that document's hits. Marking a document unreadable clears them.
- Scanned: Plans, Specifications, and Other when the file name contains "spec" or "drawing".
- One-time backfill: the first BMD staff member (view_pipeline) to open Documents or Overview runs it; `scope_scan_state.backfilled_at` makes it run once. "Scan existing documents" re-runs it on demand.

## Decisions
- Matching is on words: everything that isn't a letter or digit separates words, so hyphens and spaces are the same, and words are also joined ("loose lay", "loose-lay", "looselay"). Plural "s"/"es" is dropped from each word.
- Non-whole-word terms match at the start of a word and may carry an ending (s, es, d, ed, ing, ings): "tile" matches "tiles"/"tiled" but not "textile". Whole-word terms (CT, SV, SF, LVT, LVP) must be exactly those words, plural allowed ("LVTs", "CT-1"), never part of another word ("SFX", "act").
- A match inside a longer term's match counts only for the longer one ("carpet tile" is not also "carpet" and "tile").
- One hit row per keyword per page, with the count and a snippet of the first match (≤200 characters).
- Re-indexing replaces a document's hits, so reviewed ticks on that document reset.
- Adding or reactivating a term does not rescan by itself; press "Scan existing documents" (the add toast says so).
- Documents whose text isn't read yet show "Scan pending"; scanned files with no readable text show no badge (the row already says "scanned — no text yet").
- Hits read: view_pipeline on the job. Reviewed tick: manage_projects or capture_items. Hits are written only by the server.
- AI: the active term list is added as a system block to the spec/schedule reader (`buildScopeRequest`) and the Ask BMD assistant. The model choice (Opus 5.5+ rule) is unchanged.
- New project wizard: after uploads it waits a few seconds and shows "Scope found: …" or "Scanning for BMD scope…" as a notice before opening the Documents tab.
