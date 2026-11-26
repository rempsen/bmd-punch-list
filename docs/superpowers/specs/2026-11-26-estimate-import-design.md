# Estimate import — design note (2026-11-26)

## Intent
Import an existing estimate (XLSX, CSV or PDF) into a new or existing project.
- Faithful numbers first: the imported estimate must add up to the file to the cent.
- Each line is offered a catalogue match, with the price difference per unit shown.
- Unmatched lines can become a new catalogue product, which can then be pushed to QuickBooks as an item.
- Aliases learn from confirmations, so the same wording matches straight away next time and unmatched counts fall over time.

## Dan's decisions
- Approach C: deterministic import plus a review step, with assistance where it helps.
- The parser is deterministic. AI is used only for naming columns, splitting descriptions and re-ranking match candidates. It never produces or changes a number; prices always come from the file or from catalogue rows.
- Prompting the user to verify an item or a price is fine.

## Data model (as built)
- `estimate_imports`: one per uploaded file: project, file, sheet/header info, mapping, options (PST gross-up), status (draft / committed / undone), the committed estimate version, and file totals.
- `estimate_import_rows`: one per parsed line: raw cells, classification (group / item / total), parsed quantity, UoM, material/labour/extended costs, waste, match candidates and the saved decision (keep imported / use match / new product / skip).
- `import_templates`: column mappings remembered by header signature.
- `catalogue_aliases`: `alias_norm` (normalised wording, unique per item), `item_key` (`material` or `assembly`), `catalogue_item_id` / `assembly_id`, `uses`, `last_used_at`.
- Functions:
  - `confirm_catalogue_alias`: the only writer of aliases; it bumps `uses` and `last_used_at` on repeat.
  - `save_import_decision`: persists one row's decision as it is made; refuses changes to committed imports.
  - `commit_estimate_import`: writes the reviewed rows as one estimate version in one transaction.
  - `undo_estimate_import`: removes those lines while nobody has edited them since.

## Parser rules (`src/lib/estimate-import/parse.ts`)
- Header detection: the first row whose cells match enough known column names; its normalised cells form the header signature.
- Column synonyms map file headings to fields (description, qty, UoM, material/labour unit and extended costs, waste…). Unknown headings may be named by AI; the user confirms the mapping.
- Each row is classified as group (heading, no numbers), item (has quantity/cost), or total (subtotal/total wording). Totals are kept only to reconcile.
- Waste rule: a waste % column is carried onto the line; the extended cost in the file already includes waste and is kept as typed.
- UoM normalisation: SF/sqft/ft², SY/sqyd, LF, EA/each/pc, hour, LS/lot. SY↔SF are convertible.
- Materials tax: when a "Materials tax"/PST line is detected, the PST gross-up option is offered **on by default**. On, it folds the tax into material costs as PST on the material part; off, numbers are kept exactly as typed.
- Duplicate sheets (same header signature, same rows) are read once. Sheets with different columns are skipped with a warning.
- Templates: a confirmed mapping is saved against its header signature and reused automatically.

## Matching (`match.ts`, `match.server.ts`)
1. Alias exact: normalised wording equals a confirmed alias, giving status `exact_alias`.
2. Fuzzy: token Jaccard with flooring synonyms, +0.1 when units agree (or convert), +0.1 when the price is within ±25%. Top 5 candidates scoring ≥ 0.35 are kept.
3. AI re-rank only when no candidate scores ≥ 0.6. It orders candidates and never invents prices.
4. A verify prompt appears when the chosen candidate's price differs from the file by more than 15% per unit.

## Review flow
Upload → Mapping (columns, sheet, PST option) → Lines (match chip with best candidate and Δ per unit, bulk accept/keep, new product, running total vs file total with an acknowledge checkbox when they differ) → Commit.
- Decisions are saved as they are made; reopening resumes; committed imports open read-only.
- Imported lines show an **Imported** badge on the estimate.
- The **Imports** popover on the estimate lists imports with **Undo**.
- The New project wizard offers "Have an existing estimate? Import it".

## Fixture
`src/lib/estimate-import/__fixtures__/estimate-4811643.csv`; `build-xlsx.ts` builds the workbook (Estimate + identical Full Estimate + Summary with a 7% materials tax line).
All lines kept imported, PST gross-up **off**: material 18,426.11 · labour 9,727.30 · cost 28,153.41 · sell 38,007.10 (covered by `commit.test.ts`). With the 7% PST gross-up on, the file total is 39,748.37.

## Root cause of the earlier discrepancy
The XLSX fixture carries a separate materials-tax line. The parser detected it and, with gross-up on by default, added 7% PST onto material costs, giving cost 29,443.24 / sell 39,748.37. With gross-up off, the totals match the file exactly.

## Migrations
- 0096_catalogue_aliases
- 0097_estimate_import_v2
- 0098_estimate_import_commit
- 0099_import_decisions_alias_item_key
