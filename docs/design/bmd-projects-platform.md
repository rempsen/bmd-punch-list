# BMD Projects Platform — Design

Date: 22 November 2026 · Prepared for: Dan Rosenblat, BMD Materials · Status: awaiting approval

## 1. Intent

BMD Materials bids flooring, tile and window-covering work from architect and GC drawings. Today there is no system for incoming bid invitations. Takeoff, estimating and quote PDFs are done in Procore, then folders are created by hand in OneDrive (Customer › Sub-customer › Project) and quotes are emailed and filed manually. The deficiency tracker (the "BMD Punch" app) only covers a job once it is on site.

This project turns the tracker into one platform that carries a job from bid invitation to closed: project intake, plans and specs storage, takeoff, estimating, quoting in several versions, then the site and deficiency work that exists today, connected to Microsoft 365, QuickBooks Online, CompanyCam and ArrivePing. It replaces Procore for BMD's takeoff, estimating and quoting, and removes the manual filing around it.

## 2. Goals, non-goals, anti-goals

**Goals**

1. One record per job from opportunity to closed, visible on a pipeline board with dates and BMD staff assigned.
2. All plans, specs, vendor pricing and sent quotes stored with the job and mirrored to the existing OneDrive tree.
3. Estimates priced from a reusable catalogue of materials and supply-and-install assemblies, with waste and markup adjustable on every line, taxes, and multiple quote versions per job (Good / Better / Best or base plus alternates).
4. A polished, branded quotation PDF, emailed from the sender's own Microsoft 365 mailbox and filed automatically.
5. On-screen takeoff from PDF drawings in square feet, square yards, linear feet and counts, feeding estimate quantities directly.
6. Accepted quotes posted to QuickBooks Online as estimates on BMD's existing cost codes.
7. The current deficiency tracker keeps working unchanged throughout.
8. Change orders priced, sent and accepted against a won job, with the contract value kept current.
9. Progress billing tracked per job, including the opening materials bill and holdback, with invoices posted to QuickBooks.

**Non-goals**

- Being the accounting system. QuickBooks stays the books: payments, receivables, payroll and job costing are not built here. The app prepares estimates and invoices and posts them.
- Two-way file sync with OneDrive. The app is the working copy; OneDrive is a one-way mirror.
- Roll-goods seam and cut optimisation, pattern matching, dye-lot planning (possible later; not in these four phases).
- Fully automatic room tracing as a dependable feature. It is attempted last and labelled experimental.
- Replacing CompanyCam for site photos or ArrivePing for dispatch.
- Reading scanned (image-only) drawings automatically. Scanned sheets are measured with manual calibration.

**Anti-goals (failure even if it "works")**

- A quote leaves with a wrong number because a quantity, unit conversion, waste, markup or tax was applied silently or inconsistently.
- Cost, markup or margin is visible to a client, a trade, or on any client-facing document.
- AI output (scale, scope, areas) is applied without a person accepting it.
- The live deficiency tracker breaks or loses data during the build.
- Code is copied in under a licence that would oblige BMD to publish the app.

## 3. Constraints

- Build on the existing app: Lovable project `4ee30e5b-d222-45f5-8a77-2a181efc21f2`, TanStack Start (React 19) deployed on Cloudflare Workers, Supabase Postgres / Auth / Storage, Tailwind + shadcn, server functions (`createServerFn`), Drizzle migrations, pg_cron. Permissions are data-driven (`role_permissions`, `has_capability(capability, project)`) and enforced in row-level security; keep that pattern.
- `public.deficiencies` uses column-level SELECT grants. Any new column there needs its own grant. Prefer new tables over new columns on that table.
- Workers cannot rasterise PDFs or run native modules. All PDF rendering, text extraction and measuring is in the browser (pdf.js, lazy-loaded). Large files upload from the browser straight to Storage (resumable), never through a server function.
- Plan sets are large. The new documents bucket needs a high per-file limit (target 250 MB) and its own access policies keyed to the project.
- opentakeoff may be used only from its Apache-2.0 tag (`apache-2.0-final`, commit `84c7f48`), with notices kept. Nothing after its October 2026 AGPL relicence. Avoid MuPDF.js (AGPL). Suggested building blocks: `pdfjs-dist` (Apache-2.0), Konva or equivalent (MIT), `pdf-lib` (MIT).
- QuickBooks: BMD's company is Canadian, uses cost-code service items (01 Flooring with sub-codes, 02 Window Coverings, 03 General Conditions, 04 Markup and Contingency), tax codes "GST" and "GST/PST MB", estimates numbered sequentially (latest 127), jobs as sub-customers under a client.
- BMD's standing quote rules (already agreed): quotes show the PO Box mailing address and office@bmdmaterials.com; "Prepared by" the sender; no deposit unless stated; overdue accounts 2% monthly; one-year workmanship warranty; payment methods not listed; jobs with options get one side-by-side comparison PDF. Subcontractor names and cost never appear on client documents.
- Tax, as Dan stated it for this system: PST is a cost to BMD, included in all input (material) costs; every client-facing line and subtotal is subject to GST only. (This differs from the earlier invoice-assistant rule of GST + PST on every line; Dan's statement here governs the platform.)
- Roll goods (broadloom, sheet vinyl) are priced and ordered by the square yard with a waste percentage; the supplier works out roll lengths. Waste is a percentage per flooring or tile type.
- External set-up only Dan can do: Microsoft 365 app approval, Intuit developer app keys, a working CompanyCam token, ArrivePing API access.

## 4. Approaches considered

1. **Grow the existing app in four phases, estimating before takeoff — chosen.** Hub, then estimating and quoting, then takeoff, then ArrivePing and CompanyCam. One app, one login, one database; the riskiest piece (takeoff) does not hold up the parts that remove manual filing and deliver quote versions. Cost: BMD still measures in Procore until phase 3, entering or importing quantities.
2. **Same phases, takeoff first.** Off Procore's measuring soonest, but takeoff is the largest and least predictable build and its numbers have nowhere to go until estimating exists. Rejected.
3. **Build everything except takeoff; buy Kreo or STACK for measuring.** Fastest and their AI tracing is mature, but keeps a second tool and a manual hand-off. Kept as the fallback if phase 3 disappoints.

Dropped earlier: forking opentakeoff (licence), and a separate estimating app beside the tracker (two systems to keep in step).

Dan chose approach 1 and asked for all four phases to be built now, in order.

## 5. The design

### 5.1 Shape of the app

The app is renamed **BMD Projects**. Top-level navigation for BMD staff: Pipeline · Projects · Clients · Catalogue · Settings. Opening a project shows tabs: Overview · Documents · Takeoff · Estimate · Quotes · Site (the existing dashboard, board, floors, list, add-a-deficiency, exports, job photos) · Activity. Clients, trades and viewers see only what they see today; none of the pre-construction or pricing areas exist for them. Phone layout stays field-first (the raised Add button and deficiency flow); pipeline and documents are usable on a phone, estimating and takeoff are desktop screens.

New capabilities, added to the Roles grid and enforced in RLS: `view_pipeline`, `manage_projects`, `view_documents`, `manage_documents`, `view_pricing`, `manage_estimates`, `send_quotes`, `manage_catalogue`, `manage_integrations`. Defaults: super admin all; BMD manager all except `manage_integrations`; BMD field `view_documents` only; trade, client, viewer none. (My call.)

### 5.2 Phase 1 — Job hub

**Clients.** New `clients` table: name, billing address, phone, email, notes, QuickBooks customer id, OneDrive folder id, active. `client_contacts` holds people. First load is from a QuickBooks customer export file (CSV/XLSX) uploaded in Settings with a column-mapping step; rows that are jobs under a client ("Client: Job") are grouped under the parent, not imported as clients. Re-import updates by QuickBooks id or exact name and never deletes. Clients can also be added by hand. Once the direct QuickBooks connection exists (phase 2) the same screen gains "Refresh from QuickBooks".

**Projects.** The existing `projects` table gains: `client_id`, `project_number` (BMD sequence, e.g. 26-041), `stage`, `bid_due_date`, `estimated_value`, `lost_reason`, `lost_note`, `job_type`. Stages: Opportunity → Estimating → Quote out → Won → In progress → Closed, plus Lost. `project_stage_events` records who moved a project and when; the board shows the date a card entered its column and days in stage. Moving to Lost requires a reason (price, scope, timing, no decision, other). The existing Hyatt Centric job is set to In progress under client Kothari Group.

**New project.** One form: client picker (search, or add new), project name, site address, approximate scope (the existing scope checklist), bid due date, job type, BMD estimator and project lead, notes, and a drop zone for plans and specs. Saving creates the project in Opportunity, the documents area, and the OneDrive folder. Floors and rooms are not asked for here; the existing floors/rooms set-up becomes a "Set up site" step offered when a job is won.

**Assignment.** `project_members` gains a `job_role` (estimator, project lead, site lead, other). Only BMD staff are assignable in the pipeline. "My projects" filter on the board and list.

**Pipeline board.** Columns as above; cards show project name, client, due date (red when past), quote value when one exists, assigned initials. Drag to move on desktop, a Move button on phones. Filters: assignee, client, job type, due window. A list view of the same data with sorting and CSV export. Summary strip: count and value per column, win rate for the selected period.

**Documents.** New `project_documents` table (project, section, file name, storage path, size, mime, version number, uploaded by, note, linked catalogue material if any, OneDrive item id, mirror status and error). Sections: Plans, Specifications, Vendor quotes and data sheets, Quotes sent, Contract, Photos, Other. Uploading a file with the same name in the same section creates a new version; old versions are kept. In-app PDF and image preview. New private bucket `project-documents`, path `{project_id}/{section}/{document_id}/{filename}`, policies requiring project access plus `view_documents` / `manage_documents`.

**Microsoft 365 connection.** One Entra app registration in BMD's tenant with delegated permissions `Mail.Send`, `Files.ReadWrite.All`, `offline_access`, `User.Read`, admin-consented by Dan. Two uses:

- *Mail:* each BMD user who sends quotes connects their own mailbox once (Settings → My account → Connect Outlook). Mail is sent as that user through Microsoft Graph, so it appears in their Sent folder with their signature and replies thread normally.
- *OneDrive mirror:* one designated "library connection" (initially Dan's account, because the Customer › Project tree is in Dan's OneDrive) with the root folder chosen in Settings. Mirror is one-way, app to OneDrive: on project creation make `{Client}/{Project number – name}/` with the section subfolders; on each document save, upload it (chunked upload session for large files, streamed from Storage in ranges). A `onedrive_mirror_queue` table drives it from a frequent cron (every 5 minutes) with retries and a visible status per file; a "Mirror health" panel lists failures with a retry button. Before first use, existing client folders are matched to clients by name and confirmed by an admin; nothing existing in OneDrive is renamed, moved or deleted. If a sub-customer level exists for a client, the project can be placed under it by choosing the parent folder on the project.

Refresh tokens are stored server-side only, in a table with no client access. The existing Outlook email-intake connector is left as it is.

### 5.3 Phase 2 — Catalogue, estimating and quoting

**Catalogue (company-wide).**

- `suppliers`: name, contact, account number, notes.
- `catalogue_materials`: category (carpet broadloom, carpet tile, LVP, LVT, sheet vinyl, rubber, floor tile, wall tile, wall base, transitions, adhesive, underlay, prep, window coverings, other), name, manufacturer, product line, colour, SKU, supplier, purchase unit (SF, SY, LF, carton, roll, pail, each), coverage per purchase unit (e.g. 23.6 SF per carton, 12 ft × 100 ft roll, 250 SF per pail), unit cost as quoted by the supplier, a "PST applies" flag (on by default for materials: the app adds PST at the rate in settings, 7%, to the cost; off for items quoted PST-included or exempt), default waste %, QuickBooks cost code, active, price date and source document. Broadloom and sheet vinyl use SY as the purchase unit with no roll rounding.
- `labour_rates`: name (install LVP, install carpet tile, floor prep, base install…), unit, cost per unit, cost code.
- `assembly_templates`: a named supply-and-install package for a category with component rows. Each component is a material slot or a specific catalogue item, a labour rate, or a fixed item, with a quantity rule relative to the driving measurement ("1 per SF", "1 pail per 250 SF", "1 LF per LF of perimeter"), its own default waste, and a rounding rule (none, up to purchase unit). Seeded templates: Carpet (broadloom), Carpet tile, LVP, LVT, Sheet vinyl, Rubber flooring, Floor tile, Wall tile, Wall base, Window coverings; each with material + adhesive/setting + install labour. Editable.

**Job materials (finish tags).** Per project, `project_finishes`: the tag as it appears on the drawings (CPT-1, CPT-2, LVP-1, LVT-1, SV-1, RB-1, RF-1, WT-1…), a description, the assembly template, and the catalogue material chosen for it. This is where "create a new material, CPT-1, with manufacturer, colour, supplier, material price and labour cost" happens: pick from the catalogue or add a new catalogue item in place.

**Estimate, alternates and quotes.** A project has one estimate workspace containing a **Base** price and any number of **alternates** (`estimate_versions`: name such as Base, Alternate 1 – porcelain throughout, Alternate 2 – porcelain in main lobby only; description; default markup; sort order). An alternate is made by copying an existing one and modifying it; each is saved separately and complete in itself, so a client can be shown the job priced three or four different ways. The client accepts one.

A **quote** (`quotes`) is what gets sent: it has the number, revision, status (draft / sent / accepted / declined / superseded), validity, recipients, and the alternates it presents (one, or several side by side). Accepting a quote records which alternate was taken; that value becomes the contract value.

**Change orders.** On a won job, "New change order" opens the same worksheet for the added or changed work only. It is priced, sent and accepted exactly like a quote, numbered `CO-{n}` under the project, and can be an add or a credit. An accepted change order adds to the contract value (original contract + accepted change orders = current contract); pending and declined ones are listed but not counted. Change orders post to QuickBooks as their own estimates.

`estimate_lines` belong to a version: section (free grouping such as "Level 2 guest rooms" or "Corridors"), finish tag, description, driving quantity and unit of measure, source (manual, import, takeoff), waste %, markup %, cost code, taxable flag, tax code, notes, sort order. Each line carries `estimate_line_components`, a snapshot of the assembly at the time it was added (material, labour, sundries: unit cost, quantity rule, waste, rounding), so later catalogue price changes never alter a saved estimate; a "Refresh prices" action re-pulls on demand and shows the difference before applying.

Line kinds beyond assemblies: Prep, Miscellaneous, Delivery / freight, Subcontract, Allowance, Lump sum — each a simple cost × quantity with its own markup and cost code.

**Window coverings** are priced per piece. One line per window type (W1, W2…): type name, product, optional width and height and location note, vendor material price per piece, BMD install labour per piece, a miscellaneous per-piece charge for delivery and staging, quantity (the multiplier, e.g. 40), then markup. Seven window types on an apartment building are seven lines. A "window schedule" entry grid adds several types at once.

**Units and arithmetic** (one shared, unit-tested calculation module used by the screen, the PDF and the QuickBooks roll-up):

- Units of measure: SF, SY, LF, EA, carton, roll, pail, hour, lump sum. SY = SF ÷ 9. Linear base is entered or measured in LF.
- For each material component: net quantity = driving quantity × rule; gross = net × (1 + waste %); purchase quantity = gross converted to purchase unit and rounded up where the rule says so; cost = purchase quantity × unit cost.
- Labour is costed on the net driving quantity by default (my call), switchable per line to gross.
- Line cost = sum of components. Line sell = cost × (1 + markup %). The screen shows cost, markup %, margin % and sell; markup is the editable figure.
- Version totals: subtotal by section and by cost code, total cost, total sell, blended margin, then tax, then grand total. PST sits inside material cost (see the catalogue flag) and is never shown to the client. Every line and subtotal is charged GST (5%); a per-line override allows HST, exempt or zero-rated for out-of-province or special jobs. Rates are stored in a settings table, not hard-coded.
- All money is stored in cents; quantities to 2 decimals; rounding is applied once per line at the sell price; tax is then calculated per tax code on the summed line amounts.

**Estimate screen.** A worksheet grouped by section: tag, description, quantity + unit, waste %, cost, markup %, sell, with an expandable row showing components. Inline editing of quantity, waste, markup and unit cost; bulk set waste or markup for selected lines; drag to reorder; duplicate line; a version switcher across the top with a summary card per version (cost, sell, margin, tax, total). Quantities can be typed, pasted from Excel, or imported from a CSV/XLSX (Procore export) with column mapping.

**Working with alternates.** "Copy as alternate" duplicates all lines. "Swap finish" replaces the material behind a tag either across the whole alternate (all vinyl tile becomes porcelain) or only in chosen sections (porcelain in the main lobby, vinyl tile kept in the other elevator lobbies). A compare view shows alternates side by side by section with the differences and the price delta from Base highlighted. Marking a quote accepted records which alternate was taken, moves the project to Won, sets the contract value, and locks the lines that were quoted; the others are marked not taken. Sending freezes a snapshot of every alternate on that quote; editing afterwards and re-sending creates the next revision (R1, R2…) rather than changing what the client received.

**Quotation PDF.** Branded BMD document: client and project block, quote number (`Q-{project number}-{revision}`), date, validity, "Prepared by" the sender, scope of work by section, price presentation chosen per quote — lump sum, by section, or itemised lines (description, quantity, unit, unit price, extended) — then taxes and total; inclusions, exclusions and clarifications chosen from a reusable clause library with free-text additions; the standing terms from section 3; acceptance signature block. When more than one version is included, a single side-by-side options table. Cost, markup, margin, supplier and subcontractor names never appear. Generated in the browser with the same calculation module; preview before sending.

**Sending.** "Send quote" opens a compose panel: To / Cc from client contacts, subject and body from a template, the PDF attached, optional extra attachments from Documents. Sent through the sender's Microsoft 365 mailbox. On send: the PDF is saved to Documents › Quotes sent as `{quote number} – {project} – {date}.pdf`, mirrored to OneDrive, the version is marked sent with timestamp and recipients, and the project moves to Quote out. A "Download only" path exists for quotes Dan prefers to send himself.

**Folded in from the approved "BMD Quotes" brief (22 Nov 2026).** The brief's separate-app instruction is superseded: all of this is built inside BMD Projects, phase 2.

- *Import review.* A Procore estimate workbook, a supplier PDF, a scanned price sheet or pasted email text can be imported into an estimate. A review screen shows each source row mapped to a proposed line, with unresolved amounts flagged; nothing is created until staff confirm. Rules: group-subtotal and grand-total rows are not lines; duplicate sheets (Procore's Estimate / Full Estimate) import once; imported selling prices are preserved and marked "already marked up" so no second markup, waste or tax is applied; source taxes are recorded separately from the outgoing quote's tax; a source reconciliation (imported totals vs. source totals) is shown and must balance or be acknowledged. Unknown cost is stored as unknown, never zero; a quote cannot be issued while a required cost (install, delivery, miscellaneous) is neither entered nor explicitly marked not applicable.
- *Pricing methods.* Each line prices by markup (cost × (1 + markup)) or by target gross margin (cost ÷ (1 − margin)); the two are distinct and both are shown. Lines may also carry a fixed selling price (imported or typed). Discounts at line or quote level. Allowances and "subject to final measure" are flags shown to the client.
- *Selections.* Within a quote, a line or group is Required, Optional (client answers Yes / No / Maybe; Maybe is shown separately and excluded from the committed total) or part of a choose-one group (exactly one member counts; no double charging). These work inside each alternate.
- *Client quotation link.* Besides the emailed PDF, an issued quote can be shared as a private, unguessable, revocable link (no client account, not indexed). The client sees scope, curated photos and plans, makes selections with live totals, and accepts by typing name and email. Totals are computed on the server and checked against the issued revision at acceptance; acceptance against a superseded revision is refused; unresolved required choices block acceptance. The acceptance record stores the exact revision, choices, total, terms, payment schedule, name, email and time. This is link-based access and a typed acceptance, not verified identity, and the page says so. Costs, markup, margin, source files and internal notes are never sent to that page or its API. A frozen PDF is generated from the stored acceptance.
- *Deposit / payment schedule* shown on the quote where set.
- *CompanyCam photo picker.* Staff browse the linked CompanyCam project's photos, pick some, write client-facing captions, and attach them to sections. Chosen images are copied into private app storage with their source ids so issued quotes never change when CompanyCam does. CompanyCam comments are included only when staff opt in. Read-only toward CompanyCam.
- *Concurrent editing.* Two staff editing the same estimate never silently overwrite each other (row versions; the later save is asked to reload).
- *Test cases.* The supplied Procore workbook (`estimate-4811643`: pre-tax sales 38,007.10, source total 39,748.37, 35% markup = 25.93% margin) and the Graber quotation PDF (10 product lines / 11 units, subtotal 16,355.40) are imported as two separate jobs and must reconcile.

Cost visibility default is unchanged (office roles see pricing, field staff do not) and is adjustable in the Roles grid; the brief's "every BMD employee sees costs" is a one-click change there.

**QuickBooks Online.** Direct connection (Intuit OAuth 2.0, `com.intuit.quickbooks.accounting`, tokens server-side) in Settings → Integrations, super admin only. Functions: refresh clients; read items (cost codes) and tax codes for mapping; "Post to QuickBooks" on an accepted (or, optionally, sent) version creates an Estimate under the client — or the client's job sub-customer when one is linked or created — with one line per cost code carrying the rolled-up sell amount and a description, the mapped tax code per line, and the quote PDF attached. Roll-up rules (my calls): each estimate line posts whole under its own cost code (an LVP supply-and-install line goes to the LVP code; it is not split into material and labour codes); markup is included in each code's amount, not posted separately to 04, which is used only for lines the estimator puts there (contingency, allowances); tax in the app is calculated per tax code on the summed amounts, the same way QuickBooks does it, so the two totals agree, and the posting preview shows QuickBooks' expected total beside the quote total and blocks posting if they differ. The QuickBooks estimate number and link are stored on the quote. Posting is always an explicit button with a preview of the lines; nothing posts automatically. Until Intuit production keys exist, the same preview is available as a "QuickBooks roll-up" table to key in by hand.

### 5.4 Phase 3 — Takeoff

**Plan sets and sheets.** Any PDF in Documents › Plans can be "opened for takeoff". Its pages become `plan_sheets` (document version, page number, sheet number and title read from the title block text where available and editable, discipline, floor label, page size, rotation). Sheets list as a thumbnail strip across the top with search and "only sheets with measurements". When a revised drawing is uploaded as a new version, existing measurements stay on the old version; a "Carry forward" action copies them to the matching sheet for checking, and an overlay compare shows the two versions in two colours.

**Viewer.** pdf.js rendered to a tiled canvas with smooth zoom and pan, lazy-loaded, desktop only. A drawing overlay holds the shapes.

**Scale.** Stored per sheet as real-world units per PDF point, with provenance (suggested-and-accepted, calibrated, typed) and who set it. On opening a sheet with no scale, the app reads the PDF text layer for standard scale notations (e.g. 1/8" = 1'-0", 1:100), preferring the title block, and offers a suggestion the user must accept; if nothing unambiguous is found, or the sheet is a scan, it asks for calibration. Calibration: click two points on a known dimension and type its length. A "Check scale" tool measures any dimension and offers one-click recalibration. A sheet can hold additional scale regions for details drawn at a different scale. No measurement can be drawn on a sheet without a scale, and the scale in force is shown at all times. Changing a sheet's scale recalculates its measurements and flags the affected estimate lines.

**Conditions.** A condition is what you are measuring: it links to a project finish tag (CPT-1, RB-1…) or a plain label, has a type (area, linear, count), a colour and pattern, and a default section. The left panel is a tree: condition → sheet → shapes, with running totals in SF and SY (areas), LF (linear) and EA (counts).

**Tools.** Polygon area, rectangle area, polyline length, count marker, cut-out (deduction inside an area), split and merge, move and edit vertices, snap to existing vertices and to PDF vector line ends where the drawing is vector, undo/redo, copy shapes to another sheet (typical floors), multiply a shape or a sheet by a count ("× 28 rooms"). An area can generate its perimeter as a wall-base length, with door openings subtracted by clicking them. Each shape can carry a room or area label. Shapes are stored as vertices in PDF page coordinates (`takeoff_shapes`: sheet, condition, kind, vertices, deductions, multiplier, label, computed quantity, scale provenance, author).

**Into the estimate.** Each condition total feeds an estimate line's driving quantity (source = takeoff). The link is live: when the takeoff total changes, the estimate line shows the new quantity with a "changed since last priced" marker; a line can be detached to hold a manual override. Totals can be split by section (floor or area label) into separate lines. A takeoff summary report (by condition, by sheet, by section; net quantities, waste, order quantities) exports to PDF and Excel and can be saved to Documents. Marked-up sheets export as a PDF with a colour legend.

**AI assistance (all proposals a person accepts or rejects).**

1. *Scope reader:* extract text from the specifications and the finish schedule / legend sheets in the browser, send to a server function that calls the app's existing AI gateway, and return proposed finish tags with product, manufacturer, colour, where they apply, and the spec sections relevant to BMD's trades (flooring, tile, base, window coverings) with page references. Accepted proposals become project finishes and draft conditions.
2. *Sheet naming and sorting* from title-block text.
3. *Room tag finder:* search the text layer for a finish tag or room name and jump between hits, to speed manual measuring.
4. *One-click area (experimental, last):* click inside a room on a vector drawing to propose its boundary from the linework. Shipped behind a setting, clearly labelled, and dropped if unreliable.

### 5.5 Phase 4 — Billing, CompanyCam and ArrivePing

**CompanyCam (repair, then extend).** The stored token has returned "unauthorized" since 23 October 2026 and task creation has always failed; fix both with a new token and the current API, and register the webhook. The 1,200 photos waiting in the inbox are left untouched until Dan decides, at the start of phase 4, whether to file them or dismiss them; nothing is discarded by default. Then: when a project is created or won, offer to link or create the CompanyCam project (admin-confirmed, as now); show CompanyCam photo and document counts on the project Overview with a link; optionally push the accepted quote and marked-up plans as CompanyCam documents.

**ArrivePing.** When a project is Won or In progress, "Schedule install" lets staff define install visits (dates, crew, notes, site contact). Visits are sent to ArrivePing as jobs through an inbound endpoint or MCP key that the ArrivePing team (Dan's company) will provide; ArrivePing's existing outbound webhooks (assigned, on the way, arrived, completed) update the visit status and the project Activity feed. If inbound job creation is not ready, visits export as a CSV in ArrivePing's import format and the webhook half still works.

**Contract and progress billing (my proposal, built from Dan's description of the workflow).** A Billing tab on a won job shows original contract, accepted change orders, current contract, billed to date, holdback retained, and balance to bill. Each project has a holdback percentage (0 by default; 7.5% set on larger construction jobs). "New progress bill" builds an invoice from the contract lines by cost code: the first is typically the materials bill (materials on site or stored in the Winnipeg warehouse), later ones bill installation as it progresses, by percentage or amount per line, with previous billing shown. The invoice lists the full amount for the period, deducts the holdback, and applies GST to the net (a $100,000 bill less $7,500 holdback is $92,500 plus GST). "Release holdback" at completion creates the separate holdback invoice for the retained total plus GST. Each bill produces a branded PDF, is filed in Documents, and is posted to QuickBooks as an invoice by an explicit button with a preview. Payments and receivables stay in QuickBooks.

**Activity.** A per-project timeline of stage moves, documents, quotes sent, QuickBooks postings, install visits and deficiency milestones.

### 5.6 Rollout and safety

- Phases ship in order; each is released behind its capabilities so nothing appears for a role until switched on.
- Every migration is additive. No existing table is dropped or renamed; the deficiency tables and triggers are not altered.
- After each migration, a read check runs against the tracker's main queries (the column-grant outage must not recur).
- The calculation module has unit tests covering unit conversion, waste, carton and roll rounding, markup, per-line tax and totals, and a fixed set of worked examples checked against a spreadsheet.
- Before the app replaces Procore for a real bid, one past BMD job is re-estimated in it and compared with the quote that was actually sent.

## 6. Left to the builder

Table and column naming beyond what is given; component and file layout; canvas library choice; whether to port the Apache-tagged opentakeoff modules (scale detection, geometry, cut-outs, totals) or re-implement; tile-rendering strategy; exact board and worksheet styling within the existing BMD look; cron cadence and retry policy details; PDF layout details within the quote content listed; how each phase is split into build steps.

## 7. Needed from Dan

| Item | Needed for |
|---|---|
| QuickBooks customer export (CSV or Excel) | Phase 1 client import |
| Approve the Microsoft 365 app (steps will be provided) and connect his mailbox and OneDrive root folder | Phase 1 mirror and email |
| BMD quote wording: standard inclusions, exclusions, clarifications; a recent Procore quote PDF as a model | Phase 2 quotation |
| Current supplier price lists or a recent estimate, to seed the catalogue | Phase 2 catalogue |
| Intuit developer app (production keys) for BMD's QuickBooks company | Phase 2 QuickBooks posting |
| One full bid package (plans, specs) and the quote sent for it | Phase 3 testing and the Procore comparison |
| New CompanyCam access token | Phase 4 |
| ArrivePing inbound API or MCP key and a BMD workspace | Phase 4 |
