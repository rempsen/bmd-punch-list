# OpenTakeoff inside BMD Projects: design

Date: 2026-11-22. Status: approved by Dan through his answers of 2026-11-22 (approach, waste, staff-only assistant with shared memory); the Knowledge section was added from his last message and is his to correct before stage 6 is built. Revised the same day to add automatic takeoff and the assistant, after Dan pointed to Bobyard's takeoff features and asked for a company and project chat.

## Intent and why

BMD estimators measure flooring, base, tile and window coverings off drawings and turn the quantities into a priced quote. The takeoff screen built so far is a light viewer: area, linear, count, cut-outs, scale and a colour key, in a small fixed column. Dan wants a full estimating workspace instead, and wants it built on OpenTakeoff, an open-source takeoff tool written by a commercial flooring estimator, rather than on more home-made code. "We trust this repository's experts in this area."

He wants: the drawing filling the screen, full screen and its own window; a much fuller set of sheets, takeoff lists, libraries, layers and optional tools; every feature the repository offers; and takeoff feeding estimates and quotations. He accepts that this may replace much of today's document reading.

## Goals

1. Estimators do the whole takeoff in OpenTakeoff's workspace, opened from a project in BMD Projects, with the project's own plans already loaded.
2. The takeoff is saved in BMD Projects (not in one person's browser), so anyone with access sees the same takeoff from any computer.
3. Quantities flow into the BMD estimate without retyping, and a changed takeoff is flagged on the estimate as it is today.
4. Colour-coded, hatched, keyed drawings from the takeoff can be attached to a BMD quote.
5. Every OpenTakeoff feature present in the Apache-licensed version is available, unless listed under Non-goals.
6. BMD Projects stays private software.
7. An estimator can start an automatic takeoff on a drawing set and come back to a proposed takeoff to review, in the manner of Bobyard: rooms found and measured, finishes read from the schedule and tied to rooms, base and transitions worked out, symbols counted, each with a confidence level.
8. Anyone on BMD's staff can ask an assistant, in a side window, about the company, its products, customers and jobs, and inside a project about that project's plans, specifications, estimates and quotes, and get a short, precise answer that says where it came from.

## Non-goals

- Re-creating features OpenTakeoff added after 10 October 2026 (its own estimate, tax, overhead and profit screen and bid proposal PDF, RFI register changes, later fixes). BMD's existing estimate and quote do that job. Individual later ideas can be rebuilt on request, from the idea and not the code.
- OpenTakeoff's Google Drive and Microsoft 365 project storage, its Google sign-in, its "premium interest" panel and its "contribute training data" upload. BMD storage and BMD sign-in replace the first two; the others are switched off.
- OpenTakeoff's command box and voice dictation (off by default in OpenTakeoff itself, and they need about 45 MB of extra speech files) and its "sync to a folder on this computer" storage, which would compete with BMD storage.
- Real-time co-editing of one takeoff by two people at once.
- Phones. The takeoff workspace is for a desktop or large tablet. The rest of BMD Projects still works on a phone.

## Anti-goals

- Any code from OpenTakeoff commits after `84c7f48e` (tag `apache-2.0-final`) entering the BMD repository. Those are AGPL-3.0 and would oblige BMD to offer its whole app's source to everyone who logs in.
- A takeoff that can be silently lost: by a second person saving over it, by a browser clearing its storage, or by a failed save that looks successful.
- Costs, markups or margins reaching the takeoff workspace. It deals in quantities only.
- An AI measurement being priced before a person has accepted it. "Set it and forget it" means the work is done unattended; it does not mean unreviewed numbers reach a quote.
- The assistant telling someone something their own login could not show them (a field worker asking about margins; a trade or client asking about another job). It answers with the asker's permissions, never with its own.
- The assistant stating a price, quantity, address or number it did not read from BMD's records. When it cannot find something it says so.
- An AI key in the browser. Dan's rule: all credentials server-side.

## Constraints

- **Licence.** Source is taken only from tag `apache-2.0-final` (commit `84c7f48e`, 10 October 2026), Apache-2.0. `LICENSE`, `NOTICE` and third-party notices are kept with the vendored source, modified files carry a change note, and the workspace keeps a visible "Built on OpenTakeoff (Apache-2.0)" credit. (Not legal advice; this is how the licence text reads.)
- **Hosting.** Lovable builds and hosts the BMD app (TanStack Start on Cloudflare Workers). It will not run a second build, and one file may not exceed 25 MB. OpenTakeoff's build is 31 MB in 40 files; the largest, the on-device text-recognition engine, is 23.5 MB.
- **Stack mismatch.** OpenTakeoff is a client-only React 18 app in plain JSX with its own global stylesheet, web workers and WebAssembly; its canvas is one 11,275-line file. BMD is React 19 with server rendering and Tailwind.
- **Publishing.** Claude pushes to `main`; Dan presses Publish in Lovable. Nothing can be proven on the live site before a publish.
- **Existing rules.** PST included in input costs; no invented prices; unknown cost is not zero; quotes need approval before sending.

## Approaches considered

1. **Run OpenTakeoff as its own small app inside the BMD site (chosen).** The Apache source is kept nearly unchanged in a `vendor/opentakeoff/` folder, built here, and its built files are committed under `public/takeoff/` so Lovable serves them as static files at `/takeoff/`. The Takeoff tab shows it in a frame that fills the window, with Full screen and Open in its own window. One new module, a BMD store, replaces its browser storage with BMD's database and documents. Trade-off: two apps to keep visually consistent, and a build step that happens here rather than in Lovable. Benefit: all 63,000 lines of working, tested takeoff code are used as written, and their styles and React version cannot collide with BMD's.
2. **Compile OpenTakeoff's components into the BMD app.** One app, one look. Rejected: React 18 against 19, global CSS against Tailwind, server rendering against a browser-only canvas, and an 11,000-line file to convert. Months of porting to reach what approach 1 gives on day one, with new bugs in measuring code that is currently trusted.
3. **Port the measuring maths only and keep BMD's own screen.** Rejected: it discards the workspace, panels and tools Dan is asking for.

Dan chose "build from the October 10th Apache version and use every available feature" and left the how to Claude. Approach 1 is Claude's call.

## How it fits together

### The workspace

- Source: `vendor/opentakeoff/` holds `web/` from the tag, plus `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.md` and a `BMD-CHANGES.md` listing every file changed and why.
- Build: `bun run build:takeoff` builds it with base path `/takeoff/` into `public/takeoff/`. The output is committed. A check fails the build if any output file is over 24 MB.
- Build switches: one-click area on (`VITE_ONE_CLICK=1`); text recognition on; Google, Microsoft 365, contribute endpoint and browser AI key all unset.
- Look: OpenTakeoff's own layout is kept. Its colour tokens are set to BMD's navy and blush, the BMD logo replaces its wordmark in the top bar, and the credit line stays on its home screen.

### Opening it from a project

- The project's Takeoff tab becomes a frame showing `/takeoff/?project=<project id>`, sized to the window below the project header, with two buttons: **Full screen** and **Open in its own window**. The frame remembers nothing itself; closing and reopening shows the saved takeoff.
- Sign-in: the workspace is on the same site, so it uses the BMD session already in the browser. With no session, or no access to the project, it shows "Sign in to BMD Projects" and a link, and loads nothing.
- Access: opening needs `view_documents` on the project (field staff can look). Saving needs `manage_estimates`. A viewer without it gets a read-only workspace with a banner saying so.

### The BMD store (the one new module in the workspace)

OpenTakeoff talks to storage through a small interface: list the sheets, load a PDF's bytes, load the takeoff, save the takeoff, add a PDF, remove a PDF, and save, list and load named snapshots. `bmdStore.js` implements it:

| OpenTakeoff asks for | BMD answers with |
|---|---|
| the plan PDFs | the latest version of each document in the project's Plans folder (and Specifications, so schedules in the spec book can be read) |
| a PDF's bytes | a signed download of that document |
| the takeoff | one row per project in a new `project_takeoffs` table: the takeoff document as JSON, a version number, who saved it and when |
| save the takeoff | an update that only succeeds if the version is the one this window loaded |
| add a PDF (dropped onto the canvas, or unpacked from a zip) | an upload into the project's Plans folder through BMD's normal document path, so it gets versions and the OneDrive copy like any other document |
| remove a PDF | refused with "Remove drawings in Documents"; the takeoff workspace never deletes BMD documents |
| snapshots (their "revisions") | rows in `project_takeoff_snapshots` |
| the estimator's libraries (condition templates, material library, stamps, report settings) | one company-wide row in `takeoff_library`, so every estimator shares them |

Saving rules:

- Autosave is debounced to at most one save every few seconds.
- If the version has moved (someone else saved), the save is refused, nothing is overwritten, and the workspace shows who saved and offers **Reload their version** or **Save mine as a snapshot, then reload**.
- If a save fails for any other reason, a banner stays up until a save succeeds, and the takeoff is also kept in the browser so a reload does not lose it.
- After each successful save the workspace tells the BMD tab that opened it, which refreshes the estimate.

### Feeding the estimate

- **Finishes.** OpenTakeoff "conditions" are BMD "finishes on this job". The link is a stored id, not the tag text: each finish records the id of its condition. On save, a condition with no finish creates one (tag and description only; no material or price). Renaming a condition renames its finish's tag. Deleting a condition never deletes a finish; the finish stays, shown as "no longer in the takeoff". A finish that has a condition cannot be deleted in BMD until the condition is removed in the workspace. Finishes already on the job with no condition are offered in the workspace as conditions to start from.
- **A finish in several areas.** OpenTakeoff's per-shape label is BMD's section ("Level 2", "Corridors"). A condition "twin" (the same finish measured in another area, named "CPT-1 – Level 2") is the same finish, with the part after the dash as its section. It does not create a second finish.
- **Quantities.** On save, the store works out totals with OpenTakeoff's own totals module and writes one row per condition and section to `takeoff_quantities`: floor SF and SY, wall SF, border SF, LF, EA, plus roll-goods order footage and seam LF where a roll layout exists. Shapes still waiting for review (dashed proposals from an import or from AI) are left out until someone accepts them.
- **Waste.** Dan's decision: waste is added on the estimate. The takeoff sends measured quantities with no waste, and waste stays on the estimate line as today. The waste % on an OpenTakeoff finish is hidden or ignored. A roll-goods line takes the order footage, which already includes its layout waste, with the line's own waste at zero.
- **The estimate.** The existing link from a line to a takeoff quantity, split by section, and the "takeoff changed" banner with Accept or Keep mine, read from `takeoff_quantities` instead of the old measuring tables.

### Feeding the quote

- OpenTakeoff's Marked Set PDF (sheets with the takeoff drawn on, hatched and coloured, with a key) can be saved from the workspace into the project's Documents under Takeoff. The save records the takeoff version it was made from.
- The quote editor's "Colour-coded drawings" list offers the latest marked set's pages to tick, as it offers sheets today. The cover page with quantities is unticked by default. Drawings stay optional.
- If the takeoff has been saved since that marked set was made, sending is held with "The drawings are older than the takeoff. Save a new marked set, or untick the drawings." This replaces today's home-made colour-coded sheet rendering.

### Document reading

- OpenTakeoff's own reading replaces BMD's: sheet numbers and titles from title blocks, sheet roles, scale notes, room tags, finish schedules, text search across the set, and on-device text recognition for scanned sheets.
- Its **Import from schedule** (box a finish schedule, approve rows into conditions) becomes the main way finishes get onto a job. It needs no AI service.
- BMD's AI "Suggest finishes from the specs" stays as a second route for spec books, once the AI connection is proven.
- A drawing re-uploaded in BMD Documents as a new version shows in the workspace as a changed sheet, using OpenTakeoff's "sheet changed under your markups" handling and its revision overlay.

### What is retired

BMD's own takeoff screen and its tables (`plan_sheets`, `sheet_scales`, `takeoff_conditions`, `takeoff_shapes`) and the colour-coded sheet renderer are removed once the new workspace is live and the estimate reads from it. The only measurements in them are test data on "Test Take Off"; they are not migrated.

### The AI connection (needed by everything below)

- All AI calls go through one BMD server route that holds the key and uses the strongest Claude model on offer at or above Opus 5.5, as the existing spec-reading feature does. Dan has approved any advanced Claude model and its vision input for this.
- As of this revision the connection has never answered on the live site (it returned 400 with no reason; a fix that reports the reason is pushed but not yet published). Automatic takeoff and the assistant cannot be built further than their non-AI parts until it answers, and until it is shown to accept images.

### Automatic takeoff

The approach is OpenTakeoff's own: the AI does not guess shapes from a picture. It reads the sheets and decides what to measure, and OpenTakeoff's measuring tools, which work from the drawing's actual linework, do the measuring. That is what keeps the numbers defensible.

One button in the workspace, **Run automatic takeoff**, on the sheets the estimator ticks (default: the floor finish plans the sheet index identifies). For each sheet it:

1. Reads and sets the scale from the scale note, and checks it against a printed dimension. A sheet whose scale cannot be confirmed is skipped and reported, never measured on a guess.
2. Reads the finish schedule and legend into finishes (tag, product, colour, base), using OpenTakeoff's schedule reader, with on-device text recognition for scanned sheets.
3. Finds each room tag, looks up its floor and base finish in the schedule, and measures the room to its wall faces with the one-click engine.
4. Works out wall base from each room's perimeter less its door openings, transitions where two floor finishes meet, and cut-outs for columns and voids.
5. Counts repeated symbols the estimator has given one example of (symbol sweep).
6. Records where every assignment came from (which schedule row, which room tag) and a confidence level.

Everything it produces lands as dashed proposals, grouped by room, finish and floor, with OpenTakeoff's review list filtered to low confidence first. The estimator accepts or corrects, singly or in bulk. Proposals do not reach the estimate until accepted (see Feeding the estimate).

It runs in the open workspace tab and can be left running; a set takes minutes, not seconds. Closing the tab stops it, and what it has proposed so far is kept.

Honest limits, to be shown in the product where they apply: it is strongest on drawings exported from CAD with real linework; on scanned or photographed drawings room measuring falls back to a weaker method and more will need correcting; it does not use models trained on BMD's trade the way Bobyard's are; aerial images are out of scope.

### The assistant

A side window available on every screen to signed-in BMD staff, opened from a button in the header, and inside the takeoff workspace.

- **What it knows.** Nothing is memorised or trained in. It looks things up at the moment of asking, through a fixed set of read-only lookups that run as the person asking: company details (name, addresses, phone, email, hours, GST number, business number), the catalogue (products, labour rates, cost codes), clients, projects and their status, estimates, quotes and change orders, billing, and the text of project documents.
- **Company details.** Hours and business number are added to Company settings beside the details already there, since BMD's records do not hold them today.
- **Documents.** When a document is uploaded, or first opened in the workspace, the text of each page is stored and indexed for search, with on-device text recognition for scanned pages. In a project the assistant searches that project's pages, reads the best matches (and, for drawings, can look at the page image), and answers with the document name and page so the answer can be checked. Outside a project it can search across the projects the asker can see.
- **Knowledge (shared memory).** A Knowledge section under Company settings where BMD keeps facts the assistant should always have, for all staff and across every project. It holds three kinds of thing: short written memories ("Ceratech lead time is six weeks", "we never install over gypsum topping without a moisture test"), folders, and uploaded files (PDF, Markdown, text, Word, Excel). Uploaded files are read page by page into the same search index as project documents. Each item is marked either "all staff" or "pricing staff only"; vendor price lists and cost sheets default to pricing staff only.
- **Remembering from chat.** Someone allowed to add knowledge can say "remember that…" and the assistant saves it as a memory, shows what it saved, and it can be edited or removed in the Knowledge section. The assistant never saves a memory on its own initiative.
- **Project knowledge.** Inside a project it also searches everything filed on that project: plans, specifications, vendor quotes, estimates, quotes and change orders, and the emails BMD Projects itself holds (quotes sent, email intake). A question such as "what did Ceratech quote for ABC tile?" is answered from the vendor quotation PDF filed on the project or in Knowledge, with the document, page and date, and with the figure quoted as written.
- **Vendor prices are evidence, not catalogue prices.** A price the assistant reads from a vendor PDF is reported with its source and date. It is not written into the catalogue or an estimate; a person does that.
- **Answers.** Short and precise, with sources. It can say what a spec section requires, what a prior quote included, what was quoted per square foot on a similar job, who the client contact is, what the GST number is. It does not create, change or send anything in this version: no quote is drafted, sent or altered from chat.
- **Permissions.** Each lookup uses the asker's own login, so the database's existing rules apply: people without pricing access get no costs, margins, vendor prices or pricing-only knowledge; the assistant is not offered to trades, clients or viewers. Dan's decision: BMD staff only.
- **Record.** Each conversation is kept per person, with the lookups it made, so a wrong answer can be traced.

### AI first pass by Claude

Separately from the button above, Claude can run a first-pass takeoff through OpenTakeoff's command-line engine (53 commands at the Apache tag) from a Claude session, and import the result as dashed proposals. Nothing for this is vendored in stage 1.

## Order of work

Each stage ends with something Dan can open after a publish.

1. **Workspace live.** Vendored source, build, static hosting, BMD store for plans and the takeoff, Takeoff tab frame with full screen and own window, BMD colours and credit. Proves hosting first, and the design bets on the workspace being served from the BMD site itself. If Lovable will not serve the 23.5 MB text-recognition file, that one feature is switched off and Dan is told. If Lovable will not serve the workspace at all, work stops and the options (a second host, with a sign-in handoff) go to Dan before anything else is built.
2. **Estimate link.** Conditions to finishes, quantities table, estimate reads it, old takeoff retired.
3. **Documents.** Uploads from the canvas into BMD Documents, document versions as sheet revisions, snapshots, shared libraries.
4. **Quotes.** Marked sets saved to Documents and attached to quotes.
5. **Document text index.** Page text stored and searchable for every project document. No AI needed; it is the foundation for the assistant.
6. **Assistant.** Company and project chat. Needs the AI connection answering.
7. **Automatic takeoff.** Needs the AI connection answering and accepting images, and stages 1 and 2 live.

Stages 1 to 5 do not depend on the AI connection.

## Left to the builder

- Table and column names beyond those given; row-level security in the style of the existing tables.
- How the workspace learns the BMD session (reading the existing session from the browser, or a short-lived handoff) provided no long-lived secret is put in a URL.
- How large takeoff documents are stored if JSON in a row proves too slow (a file in storage with the version on the row is acceptable).
- The exact debounce, banner wording and frame sizing.
- Which OpenTakeoff panels are open by default.

## Claude's calls (not decisions Dan made)

- Approach 1 over 2 and 3.
- One-click area switched on, though OpenTakeoff's authors had it switched off by default at this version while re-checking its accuracy. It behaves as they built it. If it proves unreliable on BMD's drawings it is switched off again.
- Command box, voice dictation and folder sync left off (see Non-goals), although Dan said "every available feature".
- Finishes link to conditions by id; a twin is the same finish in another section; nothing in the takeoff deletes a finish.
- Shapes awaiting review do not count toward estimate quantities.
- Quotes take ticked pages from the latest saved marked set and hold sending when it is older than the takeoff.
- Removing a drawing from inside the takeoff workspace is refused.
- Libraries are company-wide, not per person.
- Test measurements in the old takeoff are discarded.
- Phones are out of scope for the workspace.
- The AI first pass by Claude runs from a Claude session, not inside BMD Projects.
- Automatic takeoff aims OpenTakeoff's measuring tools rather than having the AI draw shapes from an image, and everything it produces is a proposal.
- The assistant only reads. It does not draft, change or send quotes.
- Knowledge items carry "all staff" or "pricing staff only"; BMD managers and the admin can add, edit and remove knowledge, other staff can read what they are allowed to.
- "Shared folders" means folders inside the Knowledge section. Reading a linked OneDrive folder automatically is a later addition, not in this design.
- "Communications" means emails BMD Projects already holds (quotes sent, email intake). Reading staff mailboxes is not in this design.
- A vendor price read by the assistant is never written into the catalogue or an estimate automatically.

## Decided by Dan

- Build from the 10 October Apache version.
- Waste is added on the estimate. The takeoff sends measured quantities only.
- Opus 5.5 or later, and Claude vision, may be used.
- The assistant is for BMD staff only, and has shared memory: a Knowledge section of memories, folders and files that persists across projects.

## Open question for Dan

None at this revision.
