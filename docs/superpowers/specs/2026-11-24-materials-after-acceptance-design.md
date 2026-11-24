# Materials after a quote is accepted: design

**Status:** approved by Dan, 24 Nov 2026 ("continue with this build").

## Why
When a quote is accepted, the material behind it (from the takeoff, through the estimate) should land in Materials without anyone retyping it. From there:
- the office orders it, either by marking it ordered or by pushing a PO to QuickBooks;
- warehouse staff receive it and mark it on site.

**What's wrong today:** material is seeded only when a job *enters Won*. Test Take Off was already In progress when its quote was accepted, so nothing was seeded. Seeded lines also land as if already ordered.

## Decisions
- **Seeding is triggered by acceptance.** When a quote or change order becomes accepted, its accepted estimate version is seeded, whatever stage the job is in.
  - Each version is seeded once. The existing seed on entering Won stays as a fallback.
- **New first step, To order.** Statuses run `to_order → on_order → received → on_site`.
  - Tabs: **Ordering** (to order), **Receiving** (ordered, awaiting delivery), **To site** (in the warehouse), **On site**.
  - A line becomes ordered by **Mark ordered** (with an optional PO or reference number) or by **Create PO in QuickBooks**, which records the PO and marks the lines ordered.
- **Warehouse staff** need no new level. Dan: they may see anything. They use an existing level with materials access, such as BMD field.
- **Backfill:** accepted quotes whose version was never seeded are seeded now (Test Take Off: 7 lines).

## Approaches considered
- **Seed on quote acceptance with a database trigger. Chosen.** It works however acceptance happens: by the client online, by staff, or by AI.
- Seed from the app when staff press Accept. Rejected: client acceptance through the quote link would miss it.
- Seed when the stage changes to In progress. Rejected: the stage isn't when the scope is fixed.

## Left to the builder
- Moving a line back from Ordered is allowed only while it has no QuickBooks PO.
- Lines are listed by when they were created.
