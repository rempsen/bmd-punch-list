# Estimate in-place editing (2026-11-24)

**Rule (Dan):** any number on an estimate line can be typed over right on the line: unit cost, cost unit, order unit and conversion, line unit cost, markup, margin and sell. Markup and margin always agree.

## Maths (src/lib/estimating/overrides.ts, tested)
- margin = m/(100+m); markup = g/(100−g); margins of 100% or more are rejected.
- Markup % is what gets stored. A typed Sell is stored in `sell_override_cents` and kept when the cost changes, until it is cleared (× on the "typed" badge).
- Order units: order qty = ceil(qty × (1+waste) in cost units ÷ factor). Cost = order qty × factor × unit cost, or order qty × unit cost when priced per order unit.
- Line unit cost override: cost = qty × override. The parts are then for information only, with their per-unit figure shown beside it.

## Decisions
- Typed part costs now stay on the line ("typed here"). They no longer go into the catalogue automatically. **Push to catalogue** (with a confirm, needs view_pricing; the catalogue's own rules decide) and **Reset from catalogue** are on each linked part.
- Category markup is saved in `estimate_versions.section_markups`. It applies to lines without `markup_overridden`. Lines with markup, margin, sell or bulk markup typed on them are overridden (dot + "Reset to category").
- The base Default markup applies to new lines (as before) and now has a Margin twin.
- Order units list: SF, SY, LF, EA, carton, box, roll, bag, pail. Cost units use the catalogue's list. Choosing an order unit prefills the conversion from the catalogue when it states one in the same cost unit.
- Unlock: `unlock_estimate_version` / `relock_estimate_version` RPCs (manage_projects). While unlocked, saving is allowed. A trigger stops the unlock fields from changing any other way.
- Quote warning: shown while unlocked, when the price has an accepted quote and lines changed after unlocking.
- Audit: the new `estimate_changes` table stores each override as from/to patches, with who and when. Revert applies the "from" patch. Category and unlock entries are listed but are not revertible from the drawer. Logging failures never undo the edit.
- Totals recompute after each committed edit, not on every keystroke.
