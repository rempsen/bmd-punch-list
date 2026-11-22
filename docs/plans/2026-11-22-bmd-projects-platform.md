# BMD Projects Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the BMD deficiency tracker into BMD Projects: pipeline, documents with OneDrive mirror, estimating and quoting with alternates and change orders, on-screen takeoff, progress billing, and QuickBooks / CompanyCam / ArrivePing links.

**Architecture:** Everything is added to the existing Lovable app and its Supabase database with additive migrations. Each task is built by sending one specification message to the Lovable build agent, then verified from outside (SQL checks, the tracker read check, a signed-in browser pass on the preview) before publishing. Pure logic (pricing, tax, holdback, scale parsing, geometry) lives in small tested modules shared by screens, PDFs and postings.

**Tech Stack:** TanStack Start (React 19) on Cloudflare Workers, Supabase Postgres/Auth/Storage, Drizzle migrations, Tailwind + shadcn, `createServerFn`, pg_cron, `pdfjs-dist`, Konva (or equivalent), `pdf-lib`, `jspdf`, `xlsx`, Microsoft Graph, QuickBooks Online API, Lovable AI gateway.

**Spec:** `/mnt/user-data/outputs/BMD-Projects-Platform-Design.md` (attach to the first build message and have the agent save it as `docs/design/bmd-projects-platform.md`; later messages cite it by section).

## Global Constraints

- Lovable project `4ee30e5b-d222-45f5-8a77-2a181efc21f2`; published at `https://bmd-punch-list.lovable.app`.
- Migrations are additive only. No existing table dropped or renamed; no change to `deficiencies` triggers or its column grants.
- Permissions only through `role_permissions` + `has_capability(capability, project)`, in UI and RLS. New capabilities: `view_pipeline`, `manage_projects`, `view_documents`, `manage_documents`, `view_pricing`, `manage_estimates`, `send_quotes`, `manage_catalogue`, `manage_integrations`.
- Cost, markup, margin, supplier and subcontractor names never reach a client, trade or viewer role, nor any client-facing PDF or email.
- PDF rendering and measuring are browser-only and lazy-loaded; large files upload browser → Storage (resumable).
- Money in integer cents; quantities to 2 decimals; SY = SF ÷ 9; PST 7% added to material cost where flagged; GST 5% on every client line unless overridden; rates read from a settings table.
- AI output is always a proposal a person accepts.
- Third-party code: opentakeoff only from tag `apache-2.0-final` with notices; no AGPL dependencies.
- Secrets and OAuth tokens server-side only, in tables with no client grants.

## Verification routine (run after every task)

- [ ] **V1 Tracker read check:** signed in as a super admin, `GET /rest/v1/deficiencies?select=<the app's list select>&limit=1` returns 200 (not 403).
- [ ] **V2 SQL check:** the task's own query below returns the stated result.
- [ ] **V3 Browser pass:** on the preview, sign in, open Dashboard, Board, Add a deficiency, and the task's new screen at 1400×1000 and 390×844; no console errors, no 4xx/5xx from Supabase.
- [ ] **V4 Publish** only after V1–V3 pass; then repeat V1 on the published URL.

## Review Focus

1. Scanned, rotated or text-less drawing sheets → no scale suggestion is made and calibration is required; rotated pages measure correctly (Task 14, 15).
2. Very large plan sets (200 MB, 300 sheets) → upload resumes after a dropped connection and the viewer stays responsive (Task 4, 13).
3. Microsoft or QuickBooks token expired or revoked mid-action → nothing is marked sent/posted, the user sees "reconnect", and the action can be retried without duplicates (Task 5, 11, 12).
4. Scale changed, or a finish swapped, after quantities were priced → affected estimate lines are flagged, never silently repriced (Task 10, 16).
5. Messy client data: three-level QuickBooks names ("Client: Sub: Job"), duplicates, re-import → parents grouped correctly, nothing deleted, no duplicates (Task 1).

---

## Phase 1 — Job hub

### Task 1: Capabilities, clients and client import

**Produces:** tables `clients(id, name, billing_address, phone, email, notes, qbo_customer_id, onedrive_folder_id, active)`, `client_contacts(id, client_id, name, title, email, phone_mobile, phone_office, is_primary)`; the nine capabilities with design-section-5.1 defaults; `/clients` page; Settings → Import clients (CSV/XLSX with column mapping); `src/lib/clients/import.ts` exporting `parseQboCustomers(rows: Record<string,string>[]): { parents: ParsedClient[]; jobs: ParsedJob[] }`.

- [ ] Build message: spec above + design §5.1, §5.2 "Clients".
- [ ] Unit test `parseQboCustomers`: input names `["Kothari Group", "Kothari Group:Broadway Hotels Inc:Hyatt Centric", "Towers Realty:321 McDermot - Towers", "kothari group "]` → `parents` = `["Kothari Group", "Towers Realty"]` (trimmed, case-insensitive de-dupe), `jobs.length === 2`, the Hyatt job's `parent === "Kothari Group"` and `path === ["Broadway Hotels Inc", "Hyatt Centric"]`.
- [ ] Unit test re-import: importing the same file twice yields zero inserts and zero deletes on the second run.
- [ ] V2: `select count(*) from role_permissions where capability in (<nine>)` = 54; `select count(*) from clients` ≥ 0 and table has RLS enabled.

### Task 2: Project stages, numbering, assignment, new-project form

**Consumes:** `clients`. **Produces:** `projects` columns `client_id, project_number, stage, bid_due_date, estimated_value_cents, lost_reason, lost_note, job_type`; enum `project_stage` = `opportunity, estimating, quote_out, won, in_progress, closed, lost`; `project_stage_events(id, project_id, from_stage, to_stage, changed_by, changed_at, note)`; `project_members.job_role` (`estimator, project_lead, site_lead, other`); RPC `move_project_stage(project uuid, to_stage project_stage, reason text, note text)`; New project form at `/projects/new`; "Set up site" step (existing floors/rooms wizard) offered on Won.

- [ ] Build message: spec + design §5.2 "Projects", "New project", "Assignment".
- [ ] Test `move_project_stage`: to `lost` without a reason raises; valid move inserts one event row with `from_stage`/`to_stage`.
- [ ] Test project number: two projects created in 2026 get `26-001`-style sequential, unique numbers.
- [ ] V2: Hyatt Centric row has `stage='in_progress'` and its client name is `Kothari Group`; `select count(*) from locations` unchanged (163).

### Task 3: Pipeline board, project list, project shell, rename

**Consumes:** Task 2. **Produces:** `/pipeline` (board + list toggle, filters, summary strip, drag on desktop / Move button on phone), `/projects/$id` with tabs Overview · Documents · Takeoff · Estimate · Quotes · Site · Billing · Activity (empty tabs show "Coming in phase N"), top nav Pipeline · Projects · Clients · Catalogue · Settings for staff; app name "BMD Projects" in title, header, emails, manifest. Existing tracker routes live under the Site tab and keep their URLs.

- [ ] Build message: spec + design §5.1, §5.2 "Pipeline board".
- [ ] V3 extra: a `client` role user sees none of Pipeline/Clients/Catalogue and lands where they do today; phone still shows the raised Add button.

### Task 4: Documents

**Produces:** `project_documents(id, project_id, section, file_name, storage_path, size_bytes, mime, version, uploaded_by, note, catalogue_material_id, onedrive_item_id, mirror_status, mirror_error, created_at)`; section enum `plans, specifications, vendor, quotes_sent, contract, photos, other`; bucket `project-documents` (private, 250 MB limit), path `{project_id}/{section}/{document_id}/{filename}`; resumable (TUS) browser upload with progress and resume; version on same name+section; PDF/image preview; Documents tab.

- [ ] Build message: spec + design §5.2 "Documents".
- [ ] Test storage policy: a user who is not a member of the project gets 403 on a signed-URL request; a `bmd_field` member can read but not upload; a `client` cannot list.
- [ ] Test versioning: uploading `A-101.pdf` twice to `plans` yields versions 1 and 2, both retrievable.
- [ ] Review Focus 2: upload a 200 MB file, cut the connection at ~50%, reconnect → upload resumes and completes once.

### Task 5: Microsoft 365 connection and mail

**Needs from Dan:** Entra app registration (redirect `https://bmd-punch-list.lovable.app/api/ms/callback`; delegated `Mail.Send`, `Files.ReadWrite.All`, `offline_access`, `User.Read`; admin consent); client id, tenant id, client secret stored as `MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET`.

**Produces:** `ms_connections(user_id, account_email, refresh_token_enc, scopes, is_library_connection, onedrive_root_item_id, connected_at, last_error)` with no client grants; routes `/api/ms/connect`, `/api/ms/callback`; server module `src/lib/ms/graph.server.ts` exporting `getAccessToken(userId): Promise<string>`, `sendMailAs(userId, msg: { to: string[]; cc?: string[]; subject: string; html: string; attachments?: { name: string; contentType: string; bytes: Uint8Array }[] }): Promise<{ ok: true } | { ok: false; reason: "reconnect" | "error"; message: string }>`; Settings → My account → Connect Outlook; Settings → Integrations → Microsoft 365 (library connection, choose root folder).

- [ ] Write the step-by-step Entra instructions for Dan; receive the three values; set secrets.
- [ ] Build message: spec + design §5.2 "Microsoft 365 connection".
- [ ] Test `getAccessToken` with a revoked/invalid refresh token → `sendMailAs` returns `{ ok:false, reason:"reconnect" }` and writes `last_error` (Review Focus 3).
- [ ] Live check: Dan connects; a test email to himself arrives and is in his Sent folder.

### Task 6: OneDrive mirror

**Consumes:** Tasks 4, 5. **Produces:** `onedrive_mirror_queue(id, project_id, document_id, action, status, attempts, last_error, next_attempt_at)`; cron every 5 minutes → `/api/public/onedrive/mirror`; folder creation `{Client}/{project_number} – {name}/{Plans|Specifications|Vendor quotes and data sheets|Quotes sent|Contract|Photos|Other}`; chunked upload sessions streaming from Storage by range; Settings → "Match client folders" (name match, admin confirms); project field "OneDrive parent folder"; "Mirror health" panel with retry.

- [ ] Build message: spec + design §5.2 mirror paragraph.
- [ ] Test: mirror never issues a delete, move or rename call to Graph (assert on the client wrapper's call log).
- [ ] Test: a failed upload is retried with back-off and surfaces in Mirror health after 3 attempts.
- [ ] Live check: create a test project, upload a PDF, see it in Dan's OneDrive under the right client; then archive the test project.

**Phase 1 gate:** publish; Dan imports clients, creates one real opportunity with plans, and confirms the OneDrive folder.

---

## Phase 2 — Catalogue, estimating, quoting

### Task 7: Calculation module

**Produces:** `src/lib/estimating/calc.ts` exporting:

```ts
type Uom = "SF"|"SY"|"LF"|"EA"|"carton"|"roll"|"pail"|"hour"|"LS";
type Component = { kind: "material"|"labour"|"fixed"; unitCostCents: number; costUom: Uom; purchaseUom: Uom;
  coveragePerPurchaseUnit?: number; qtyPerDriver: number; wastePct: number;
  roundUp: boolean; pstApplies: boolean; onGross?: boolean };
type Line = { driverQty: number; driverUom: Uom; markupPct: number; taxCode: "GST"|"HST"|"EXEMPT"|"ZERO"; components: Component[] };
convert(qty: number, from: Uom, to: Uom): number
priceLine(line: Line, rates: { pstPct: number }): { costCents: number; sellCents: number; marginPct: number; components: { purchaseQty: number; costCents: number }[] }
totals(lines: { sellCents: number; taxCode: string; costCode: string; section: string }[], rates: { gstPct: number; hstPct: number }): { subtotalCents: number; byCostCode: Record<string,number>; bySection: Record<string,number>; taxCents: number; totalCents: number }
```

- [ ] Test `convert(4500,"SF","SY") === 500`.
- [ ] Test LVP line: 1000 SF; material $2.50/SF sold by 23.6 SF carton, waste 10%, roundUp, PST applies; labour $1.75/SF, no waste; markup 30% → material purchase 47 cartons, material cost 296711 (47 × 23.6 × 250 = 277300, +7% PST), labour 175000, `costCents === 471711`, `sellCents === 613224`.
- [ ] Test broadloom: 4500 SF driver, material $32.00/SY, waste 8%, no roundUp → purchaseQty 540 SY.
- [ ] Test window covering: EA 40; vendor $310, labour $45, misc $12 per piece; PST on vendor only; markup 35% → cost 40 × (331.70 + 45 + 12) = 1554800, sell 2098980.
- [ ] Test `totals`: lines 613224 + 2098980 GST → subtotal 2712204, tax 135610, total 2847814.
- [ ] Test labour `onGross: true` uses the wasted quantity.

### Task 8: Catalogue

**Produces:** `suppliers`, `catalogue_materials`, `labour_rates`, `assembly_templates`, `assembly_template_components` per design §5.3; `tax_settings(pst_pct, gst_pct, hst_pct)`; seeded templates (Carpet broadloom, Carpet tile, LVP, LVT, Sheet vinyl, Rubber flooring, Floor tile, Wall tile, Wall base, Window coverings); `/catalogue` with tabs Materials · Labour · Assemblies · Suppliers; Excel import for materials.

- [ ] Build message. V2: 10 templates seeded; RLS: a `bmd_field` user selecting `catalogue_materials` gets zero rows / 403.

### Task 9: Project finishes and estimate worksheet

**Consumes:** Tasks 7, 8. **Produces:** `project_finishes(id, project_id, tag, description, assembly_template_id, catalogue_material_id)`; `estimate_versions(id, project_id, name, description, default_markup_pct, sort_order, is_base)`; `estimate_lines(id, version_id, section, finish_id, kind, description, driver_qty, driver_uom, source, waste_pct, markup_pct, cost_code, tax_code, notes, sort_order, takeoff_condition_id, detached)`; `estimate_line_components` (snapshot); Estimate tab worksheet with inline edit, bulk waste/markup, component drill-down, window-schedule grid, paste/import quantities; "Refresh prices" with diff.

- [ ] Build message + design §5.3. Test: editing a catalogue price does not change a saved line's cost until Refresh prices is confirmed. Test: worksheet totals equal `calc.totals` for the same lines.

### Task 10: Alternates

**Produces:** "Copy as alternate"; `swapFinish(versionId, fromFinishId, toFinishId, sections?: string[])`; compare view with delta from Base.

- [ ] Test: swap limited to `["Main lobby"]` changes only those lines; lines in other sections keep their components.
- [ ] Test (Review Focus 4): a swapped line shows its new price immediately in the worksheet and the previous price in the compare delta; a line with a manual unit-cost override is flagged "override kept", not overwritten.

### Task 11: Quotes, sending, acceptance, change orders

**Consumes:** Tasks 5, 6, 9, 10. **Produces:** `quotes(id, project_id, kind 'quote'|'change_order', number, revision, status, validity_days, presentation 'lump_sum'|'by_section'|'itemised', snapshot jsonb, sent_at, sent_by, recipients, accepted_version_id, accepted_at, accepted_value_cents, qbo_estimate_id, document_id)`; `quote_clauses` library (inclusions, exclusions, clarifications); branded PDF (`src/lib/quotes/pdf.ts`) with standing terms from design §3 and side-by-side alternates table; compose-and-send panel; Download only; acceptance → project Won + contract value; revisions; change orders numbered `CO-n`; contract value view (`original + accepted COs`).

- [ ] Test PDF content: for a fixture quote, extracted PDF text contains the sell total and does not contain any of: the cost total, the markup %, the supplier name, a subcontractor name.
- [ ] Test numbering: first quote `Q-26-001-R0`, re-send after edit `R1`; first change order `CO-1`.
- [ ] Test send failure (Review Focus 3): when `sendMailAs` returns `reconnect`, quote status stays `draft`, no document is filed, project stage unchanged.
- [ ] Test acceptance: accepting Alternate 2 sets `accepted_value_cents` to its total, locks its lines, marks the project `won`; an accepted `CO-1` of +$4,200 raises current contract by 420000.

### Task 11a: Import review (from the BMD Quotes brief)

**Produces:** `estimate_imports(id, project_id, document_id, kind, status, source_totals jsonb, reconciliation jsonb)`, `estimate_import_rows(id, import_id, source_ref, raw jsonb, proposed jsonb, issue, decision)`; `src/lib/estimating/import-procore.ts` exporting `parseProcoreEstimate(workbook): { rows: ImportRow[]; sourceTotals: {...} }`; review screen; lines created with `price_basis` `markup | margin | fixed_sell` and `cost_known` flags.

- [ ] Test with `estimate-4811643.xlsx`: Estimate and Full Estimate sheets import once; subtotal/total rows excluded; summed material sales = 24,875.25 and labour sales = 13,131.85 (pre-tax 38,007.10); imported lines are `fixed_sell` and re-pricing them does not change their sell.
- [ ] Test: `sellFromMargin(cost, 25.9259)` ≈ `sellFromMarkup(cost, 35)`; a line with unknown install cost blocks "Issue quote" until entered or marked not applicable.
- [ ] Test Graber PDF import: 10 product lines, 11 units, subtotal 16,355.40; option detail amounts are not charged twice.

### Task 11b: Selections, client link and acceptance (from the BMD Quotes brief)

**Produces:** line `selection` (`required | optional | choose_one` + group id) and client state `yes | no | maybe`; `quote_share_links(token_hash, quote_id, revoked_at)`; public route `/q/$token`; server fns `getPublicQuote(token)`, `saveSelections(token, choices)`, `acceptQuote(token, { name, email, choices, revision })`; `quote_acceptances`; frozen acceptance PDF; `quote_assets` (CompanyCam photo copies with source ids) and photo picker; row-version check on estimate saves.

- [ ] Test: `getPublicQuote` response contains no key matching `/cost|markup|margin|supplier|internal/i` (deep scan of a fixture).
- [ ] Test: Maybe items are excluded from the committed total; a choose-one group counts exactly one member; acceptance with an unresolved required choice is refused; acceptance against a superseded revision is refused; server total must equal the stored issued total for the submitted choices.
- [ ] Test: revoked or unknown token → 404 with no data; page sends `noindex`.
- [ ] Test: two saves from the same starting row version → the second is rejected with "reload".

### Task 12: QuickBooks Online

**Needs from Dan:** Intuit developer app production keys (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`), redirect `https://bmd-punch-list.lovable.app/api/qbo/callback`.

**Produces:** `qbo_connection` (single row, tokens server-side); `cost_code_map(cost_code, qbo_item_id)`, tax-code map; Refresh clients; `buildQboEstimate(quoteSnapshot): { customerRef; lines: { itemId; amountCents; description; taxCode }[]; expectedTotalCents }`; Post-to-QuickBooks preview and button; PDF attach; manual "QuickBooks roll-up" table when not connected.

- [ ] Test `buildQboEstimate`: fixture with three lines on two cost codes → two lines, amounts sum to the quote subtotal, `expectedTotalCents` equals the quote total; posting is blocked when they differ.
- [ ] Test idempotency: posting the same quote twice creates one estimate (second call returns the stored `qbo_estimate_id`).

**Phase 2 gate:** re-estimate one past BMD job and compare with the quote actually sent.

---

## Phase 3 — Takeoff

### Task 13: Sheets and viewer

**Produces:** `plan_sheets(id, document_id, page_number, sheet_number, title, discipline, floor_label, width_pt, height_pt, rotation)`; Takeoff tab; lazy `pdfjs-dist` tiled viewer with zoom/pan; thumbnail strip with search.

- [ ] Test: route bundle for non-takeoff pages does not include pdf.js (build stats). Review Focus 2: a 300-page set opens to first sheet in under 5 s on the preview and page switch under 1 s.

### Task 14: Scale

**Produces:** `src/lib/takeoff/scale.ts`: `parseScaleText(s: string): { ratio: number } | null`, `feetPerPoint(ratio: number): number`, `suggestScale(textItems: { str: string; x: number; y: number }[], page: { width: number; height: number }): { ratio: number; source: string } | null`, `calibrate(p1, p2, realFeet: number): number`; `sheet_scales(sheet_id, region, feet_per_point, provenance, set_by, set_at)`; accept-suggestion prompt, two-click calibrate, Check scale tool, scale regions; no drawing without a scale.

- [ ] Test `parseScaleText('1/8" = 1\'-0"')` → ratio 96; `'1/4" = 1\'-0"'` → 48; `'1:100'` → 100; `'SCALE: N.T.S.'` → null.
- [ ] Test `feetPerPoint(96)` ≈ 0.11111.
- [ ] Test `suggestScale`: two different scale strings on one sheet → null (ambiguous); no text items → null (Review Focus 1).
- [ ] Test `calibrate`: points 144 pt apart labelled 16 ft → 0.11111.

### Task 15: Conditions, tools, geometry

**Produces:** `src/lib/takeoff/geometry.ts`: `polygonArea(pts)`, `polylineLength(pts)`, `areaWithCutouts(outer, holes[])`, `perimeterLessOpenings(pts, openings[])`; `takeoff_conditions(id, project_id, finish_id, label, kind 'area'|'linear'|'count', colour, default_section)`; `takeoff_shapes(id, sheet_id, condition_id, kind, vertices jsonb, cutouts jsonb, multiplier, label, section, qty, scale_feet_per_point, scale_provenance, created_by)`; tools per design §5.4; left tree with SF/SY/LF/EA totals; undo/redo.

- [ ] Test: 20 ft × 15 ft rectangle at 0.11111 ft/pt → 300.00 SF, 33.33 SY; with a 5 × 4 cut-out → 280.00 SF; perimeter 70 LF less one 3 ft opening → 67 LF; multiplier 28 → 8400 SF.
- [ ] Test (Review Focus 1): the same rectangle on a page with `rotation: 90` measures 300.00 SF.

### Task 16: Takeoff into estimate, reports

**Produces:** live link condition total → `estimate_lines.driver_qty` (`source='takeoff'`), "changed since last priced" marker, detach/override, split by section; takeoff summary (PDF/Excel) and marked-up sheet export saved to Documents.

- [ ] Test (Review Focus 4): changing a sheet's scale recomputes its shapes and flags every linked estimate line; flagged lines keep their previous priced quantity until the estimator accepts.
- [ ] Test: a detached line ignores takeoff changes.

### Task 17: Drawing revisions

**Produces:** carry-forward of shapes to a new document version's matching sheet (by sheet number), marked "needs checking"; two-colour overlay compare.

- [ ] Test: carry-forward never deletes or alters shapes on the old version.

### Task 18: AI assistance

**Produces:** server fn `proposeScope(projectId, { specText, scheduleText })` → proposals `{ tag, product, manufacturer, colour, appliesTo, specRef, confidence }[]` stored in `ai_proposals(status 'proposed'|'accepted'|'rejected')`; sheet auto-naming; tag finder; experimental one-click area behind a setting.

- [ ] Test: nothing in `project_finishes` or `takeoff_conditions` changes until a proposal is accepted. Test: the request sends extracted text only, never the PDF binary, and never any pricing.

**Phase 3 gate:** take off one real bid package end to end and compare quantities with the Procore takeoff.

---

## Phase 4 — Billing, CompanyCam, ArrivePing

### Task 19: Contract and progress billing

**Produces:** `projects.holdback_pct`; `progress_bills(id, project_id, number, kind 'progress'|'holdback_release', period_note, gross_cents, holdback_cents, net_cents, gst_cents, total_cents, lines jsonb, status, qbo_invoice_id, document_id)`; `src/lib/billing/calc.ts`: `billTotals(grossCents, holdbackPct, gstPct)`; Billing tab; invoice PDF; post to QuickBooks as invoice with preview.

- [ ] Test `billTotals(10000000, 7.5, 5)` → holdback 750000, net 9250000, GST 462500, total 9712500.
- [ ] Test: holdback release for retained 750000 → net 750000, GST 37500, total 787500; billed-to-date can never exceed current contract.

### Task 20: CompanyCam repair and extension

**Needs from Dan:** new CompanyCam token; decision on the 1,200-photo backlog.

- [ ] Replace token; confirm `GET /v2/company` 200; fix task creation against the current API; register webhook; link/create on project create or won; counts on Overview. Test: 24 h of sync log with zero 401/404.

### Task 21: ArrivePing

**Needs from Dan:** inbound endpoint or MCP key, workspace, webhook secret.

**Produces:** `install_visits(id, project_id, starts_at, ends_at, crew, notes, site_contact, arriveping_job_id, status)`; "Schedule install"; outbound create (or CSV export fallback); `/api/public/arriveping/webhook` verifying `X-Webhook-Secret`.

- [ ] Test: webhook with a bad secret → 401; `arrived` event updates the visit status and adds an Activity entry.

### Task 22: Activity timeline and final regression

- [ ] Activity tab aggregating stage moves, documents, quotes, postings, bills, visits, deficiency milestones.
- [ ] Full verification routine on the published site with each role (super admin, BMD manager, BMD field, trade, client, viewer); confirm a client and a trade can see no pricing anywhere, including via the REST API on every new table.

## Self-review notes

Spec coverage checked section by section; every design section maps to a task (5.1 → T1, T3; 5.2 → T1–T6; 5.3 → T7–T12; 5.4 → T13–T18; 5.5 → T19–T22; 5.6 → verification routine and gates). Items waiting on Dan are named in the task that needs them, and each has a fallback so the next task is not blocked.
