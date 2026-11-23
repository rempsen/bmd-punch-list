# OpenTakeoff Stage 1 (Workspace Live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The project's Takeoff tab opens the Apache-licensed OpenTakeoff workspace, full window, with the project's plans loaded and the takeoff saved in BMD Projects.

**Architecture:** OpenTakeoff's `web/` app at tag `apache-2.0-final` is vendored under `vendor/opentakeoff/`, built with base path `/takeoff/`, and its output committed to `public/takeoff/` so Lovable serves it as static files. One new module in the vendored app, a BMD store, replaces browser storage with BMD's database and documents through OpenTakeoff's own storage seam (`setActiveStore`). The BMD app shows it in a frame.

**Tech Stack:** OpenTakeoff (React 18, Vite, pdf.js, plain JSX); BMD Projects (TanStack Start, React 19, Supabase with row-level security, bun test); `@supabase/supabase-js` added to the vendored app.

**Spec:** `docs/superpowers/specs/2026-11-22-opentakeoff-integration-design.md`

## Global Constraints

- Source comes only from tag `apache-2.0-final` (commit `84c7f48e`). No code from later OpenTakeoff commits (AGPL-3.0) enters this repository, by copy, paste or paraphrase of code.
- `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.md` stay with the vendored source. Every vendored file that is changed is listed in `vendor/opentakeoff/BMD-CHANGES.md` with the reason, and carries a `// BMD change:` comment at the change.
- The workspace keeps a visible credit: "Built on OpenTakeoff (Apache-2.0)".
- No built file over 24 MB (Lovable's limit is 25 MB).
- Build switches: `VITE_ONE_CLICK=1`, `VITE_OCR` as the tag's default; `VITE_GOOGLE_CLIENT_ID`, `VITE_DRIVE_ROOT_FOLDER_ID`, `VITE_MSAL_CLIENT_ID`, `VITE_CONTRIBUTE_ENDPOINT`, `VITE_AI_KEY`, `VITE_AI_ENDPOINT`, `VITE_COMMAND_BOX` all unset.
- Costs, markups and margins never reach the workspace. It reads documents and writes takeoff rows only.
- No long-lived secret in a URL. The only thing in the workspace URL is the project id.
- Opening needs `view_documents` on the project; saving needs `manage_estimates`. Enforced by row-level security, not by the workspace.
- The workspace never deletes or replaces a BMD document.
- A save never overwrites a takeoff saved by someone else since this window loaded.
- Commits go to `feat/bmd-projects` and reach `main` through the patch workflow in `.superpowers/sdd/.../progress.md`; Dan presses Publish. Nothing on the live site is proven until he has.
- Test data on the live database is created only on project `2f64d344-9c0e-4c66-a88f-c1d23ee6481a` (Dan's "Test Take Off") or inside a transaction that is rolled back.

## Review Focus

1. Two projects each holding a drawing with the same file name: each project must see only its own drawing and its own cached bytes.
2. A drawing replaced by a new version in BMD Documents while a takeoff exists on it: the workspace must show the new bytes and say the sheet changed, not silently keep the old cached copy.
3. A save that fails (offline, session expired mid-work): the estimator must be told and the work must survive a reload.
4. A person signed in to BMD but not a member of the project, or signed out, opening the workspace URL directly: nothing of the project loads.
5. A very large takeoff document (thousands of shapes): saving must not time out or silently truncate.

---

### Task 1: Vendor the source, build it, prove Lovable serves it

**Files:**
- Create: `vendor/opentakeoff/` (copy of `web/` from the tag without `test/`, `bench/`, `review/`, `node_modules/`, `dist/`; plus `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.md`, `BMD-CHANGES.md`)
- Create: `scripts/takeoff-build-check.mjs`, `scripts/takeoff-build-check.test.ts`
- Create: `public/takeoff/**` (build output)
- Modify: `package.json` (scripts `build:takeoff`, `check:takeoff`), `vendor/opentakeoff/web/vite.config.js` (base and outDir), `.prettierignore`, `eslint.config.js`, `tsconfig.json` (exclude `vendor`, `public/takeoff`)

**Interfaces:**
- Produces: the workspace at `/takeoff/index.html`; `checkBuild(files: {path: string; bytes: number}[], indexHtml: string): string[]` returning problems (empty when fine).

- [ ] **Step 1: Write the failing test** `scripts/takeoff-build-check.test.ts`

```ts
import { expect, test } from "bun:test";
import { checkBuild } from "./takeoff-build-check.mjs";
const html = '<script type="module" src="/takeoff/assets/index-a.js"></script><link href="/takeoff/assets/i.css">';
test("a good build passes", () => expect(checkBuild([{ path: "assets/index-a.js", bytes: 2_000_000 }], html)).toEqual([]));
test("a file over 24 MB is named", () => expect(checkBuild([{ path: "assets/ort.wasm", bytes: 24 * 1024 * 1024 + 1 }], html)[0]).toContain("assets/ort.wasm"));
test("assets not under /takeoff/ are named", () => expect(checkBuild([], '<script src="/assets/index-a.js"></script>')[0]).toContain("/assets/index-a.js"));
test("a build with no entry script fails", () => expect(checkBuild([], "<html></html>").length).toBe(1));
```

- [ ] **Step 2: Run** `bun test scripts/takeoff-build-check.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `checkBuild` and a CLI in the same file that walks `public/takeoff`, prints problems and exits 1 when any.
- [ ] **Step 4: Vendor.** Copy the tree; in `vite.config.js` set `base: "/takeoff/"` and `build.outDir: "../../../public/takeoff"` (`emptyOutDir: true`), each with a `// BMD change:` comment; start `BMD-CHANGES.md`. Add `"build:takeoff": "cd vendor/opentakeoff/web && npm ci --no-audit --no-fund && VITE_ONE_CLICK=1 npx vite build"` and `"check:takeoff": "node scripts/takeoff-build-check.mjs"`.
- [ ] **Step 5: Run** `bun test scripts/takeoff-build-check.test.ts` then `bun run build:takeoff && bun run check:takeoff`. Expected: tests PASS; check prints nothing and exits 0; `public/takeoff/index.html` exists.
- [ ] **Step 6: Run** `bun test && bunx tsc --noEmit && bunx vite build`. Expected: the existing 305 tests plus 4 pass; type check and BMD build unaffected by `vendor/`.
- [ ] **Step 7: Verify locally.** `bunx vite dev`, open `/takeoff/index.html`: the OpenTakeoff home screen renders, the sample plan opens, no console errors.
- [ ] **Step 8: Commit and push** (source by patch; the 31 MB build output is produced on Dan's Mac by running `bun run build:takeoff` there and committed there, because a patch that size cannot be carried).
- [ ] **Step 9: Stop for the hosting proof.** Ask Dan to Publish, then fetch `https://bmd-punch-list.lovable.app/takeoff/index.html` and the largest asset. Expected: both 200. If the large wasm is refused, set `VITE_OCR=0`, rebuild, record a ruling, tell Dan. If the workspace is not served at all, stop: the design says the options go to Dan.

### Task 2: Where the takeoff is saved

**Files:**
- Create: `drizzle/migrations/0043_project_takeoffs.sql`; Modify: `drizzle/migrations/meta/_journal.json`

**Interfaces:**
- Produces:
  - `project_takeoffs(project_id uuid pk → projects on delete cascade, doc jsonb not null, version int not null default 1, updated_by uuid, updated_at timestamptz)`; `octet_length(doc::text) <= 50_000_000`.
  - `project_takeoff_snapshots(id uuid pk, project_id uuid, label text, doc jsonb, created_by uuid, created_at timestamptz)`.
  - `takeoff_library(id int pk check (id = 1), templates jsonb, materials jsonb, stamps jsonb, updated_by, updated_at)`, one seeded row.
  - `save_project_takeoff(_project uuid, _doc jsonb, _expected_version int) returns int` (the new version). `_expected_version = 0` means "no takeoff existed when I loaded". On mismatch raises `TAKEOFF_CONFLICT:<version>:<saver's name>`. Security definer; requires `can_project_documents(_project, false)` and `has_capability('manage_estimates')`.
  - Read policies: `can_project_documents(project_id, false)` on both project tables; `has_capability('view_documents')` on the library. Library update: `has_capability('manage_estimates')`. Snapshots insert/delete: same as save.

- [ ] **Step 1: Write the behaviour test** as a `DO` block (pattern in the ledger) on project `2f64d344-…`, impersonating Dan and one non-staff member, ending `RAISE EXCEPTION 'RESULT …'`. Assertions: first save with expected 0 returns 1; save with expected 1 returns 2; save with expected 1 again raises `TAKEOFF_CONFLICT:2:`; non-staff member reads 0 rows and their save raises; a field-role user can read but their save raises.
- [ ] **Step 2: Run it** against the live database. Expected: fails, relation does not exist.
- [ ] **Step 3: Write and apply the migration** (DDL alone in one call).
- [ ] **Step 4: Run the behaviour test.** Expected: `RESULT` line shows every assertion true, and the rollback leaves no rows.
- [ ] **Step 5: Commit.**

### Task 3: The BMD store

**Files:**
- Create: `vendor/opentakeoff/web/src/lib/bmd/bmdStore.js`, `vendor/opentakeoff/web/src/lib/bmd/bmdStore.test.js`
- Read first: `vendor/opentakeoff/web/src/lib/store.js` (the interface), `vendor/opentakeoff/web/src/lib/cloudStore.js` (a store whose PDFs are not in the browser)

**Interfaces:**
- Consumes: an injected `api` (Task 4 supplies the real one):
  - `listDocuments(): Promise<{id: string; name: string; section: "plans"|"specifications"; versionId: string; hash?: string}[]>` (latest version of each PDF)
  - `download(versionId): Promise<Uint8Array>`
  - `loadTakeoff(): Promise<{doc: object|null; version: number}>`
  - `saveTakeoff(doc, expectedVersion): Promise<number>` rejecting with `{conflict: {version, by}}` on a conflict
  - `upload(file: File): Promise<void>`
  - `snapshots: {list, get, put, remove}`, `library: {load(), save(part, value)}`
  - `canSave: boolean`
- Consumes: an injected `cache` (`get(key)`, `put(key, value)`) for PDF bytes and the crash copy, keyed with the project id.
- Produces: `createBmdStore({projectId, api, cache, onState}) → store` with every method `localStore` has. `onState({kind: "saved"|"saving"|"failed"|"conflict"|"readonly", version?, by?, message?})`.

Behaviour the tests pin (one test each, names as written):

- [ ] **Step 1: Write the failing tests**
  - `lists only this project's PDFs, plans before specifications` : two documents named `A-101.pdf` in different sections list as `A-101.pdf` and `Specifications - A-101.pdf`.
  - `loads bytes once and serves them from the cache afterwards` : second `loadPdfData` makes no `download` call.
  - `a new document version is downloaded again and reported as a revision` : after `listDocuments` returns a new `versionId` for the same name, `loadPdfData` downloads again and `listPdfRevisions(name)` has two entries.
  - `the cache is per project` : a store for project B never returns project A's bytes for the same name.
  - `an empty project loads the empty takeoff` : `loadAnnotations()` deep-equals `emptyAnnotations()`.
  - `saves carry the version that was loaded and move it forward` : load at version 3, save → `saveTakeoff(doc, 3)`; next save → `saveTakeoff(doc, 4)`.
  - `saves are one at a time and the latest wins` : three `saveAnnotations` calls while one is in flight produce exactly two `saveTakeoff` calls, the second with the third payload.
  - `a conflict stops saving and reports who saved` : after `{conflict: {version: 5, by: "Brian"}}`, `onState` gets `{kind: "conflict", version: 5, by: "Brian"}` and further `saveAnnotations` calls do not call `saveTakeoff`.
  - `a failed save is kept in the browser and reported` : rejection → `cache.put("crash:<project>", payload)` and `onState({kind: "failed"})`; the next success clears it and reports `saved`.
  - `a crash copy newer than the saved takeoff is offered on load` : `loadAnnotations()` returns the saved doc and `store.pendingRecovery()` returns the crash copy.
  - `read-only never saves` : with `canSave: false`, `saveAnnotations` resolves, calls nothing, and `onState` was `readonly`.
  - `removing a drawing is refused` : `removePdf("x.pdf")` rejects with `Remove drawings in Documents.`
  - `a dropped file is uploaded to the project's plans` : `addPdf(file)` calls `api.upload(file)` once and the file then appears in `listSheets()`.
  - `libraries are the company's` : `loadTemplates/saveTemplates`, `loadMaterialLibrary/saveMaterialLibrary`, `loadStampLibrary/saveStampLibrary` go to `api.library`.
  - `a 20 MB takeoff saves whole` : a payload of 200,000 shapes reaches `saveTakeoff` deep-equal to what was passed.
- [ ] **Step 2: Run** `bun test vendor/opentakeoff/web/src/lib/bmd`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `createBmdStore`.** PDF hashing follows `cloudStore.js`'s approach so the on-device text-recognition cache keeps working.
- [ ] **Step 4: Run the tests.** Expected: all PASS.
- [ ] **Step 5: Commit.**

### Task 4: Signing in and mounting

**Files:**
- Create: `vendor/opentakeoff/web/src/lib/bmd/bmdApi.js`, `bmdApi.test.js`, `vendor/opentakeoff/web/src/components/BmdGate.jsx`, `BmdBanner.jsx`
- Modify: `vendor/opentakeoff/web/src/main.jsx` (route `?project=` to `BmdGate` when `import.meta.env.VITE_BMD === "1"`), `vendor/opentakeoff/web/package.json` (`@supabase/supabase-js`), root `package.json` (`build:takeoff` passes `VITE_BMD=1` and BMD's `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env`)

**Interfaces:**
- Consumes: Task 2 tables and RPC; Task 3 `createBmdStore`; BMD's `project_documents` rows and `project-documents` bucket (see `src/lib/documents/logic.ts`, `upload.ts`).
- Produces: `createBmdApi(supabase, projectId) → api` (Task 3's shape); `parseConflict(message: string): {version: number; by: string} | null`; `gateState({session, project, canSave}) → "signin" | "noaccess" | "readonly" | "ready"`; after each successful save `window.parent`/`window.opener` receive `postMessage({type: "bmd-takeoff-saved", projectId, version}, location.origin)`.

- [ ] **Step 1: Write the failing tests**: `parseConflict("TAKEOFF_CONFLICT:5:Brian Chornoboy")` → `{version: 5, by: "Brian Chornoboy"}`; other text → `null`; `gateState` for no session → `signin`, session but no project row → `noaccess`, project without `manage_estimates` → `readonly`, with it → `ready`; `listDocuments` maps document rows to the latest PDF per document and ignores non-PDFs.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The session is the BMD session already in the browser for this origin (same Supabase storage key as `src/integrations/supabase/client.ts`); uploads follow `uploadDocument` in BMD (`section: "plans"`).
- [ ] **Step 4: Implement `BmdGate`** (states above; `signin` and `noaccess` render a message and a link to `/auth` or `/projects` and mount nothing else) and `BmdBanner` (saving, saved, failed with Retry, conflict with **Reload their version** / **Save mine as a snapshot, then reload**, read-only, recovery offer).
- [ ] **Step 5: Run tests; rebuild; verify locally** signed in as Dan on project `2f64d344-…`: the 43-sheet set lists, a sheet renders, an area drawn and saved survives a reload in a second browser context; signed out, the URL shows the sign-in message and makes no document requests.
- [ ] **Step 6: Commit.**

### Task 5: The Takeoff tab

**Files:**
- Create: `src/lib/takeoff/workspace.ts`, `src/lib/takeoff/workspace.test.ts`, `src/components/takeoff/TakeoffWorkspace.tsx`
- Modify: `src/routes/_authenticated/projects.$id.tsx` (Takeoff tab renders `TakeoffWorkspace`, full width)

**Interfaces:**
- Consumes: Task 4's message.
- Produces: `workspaceUrl(projectId: string): string` → `/takeoff/index.html?project=<id>`; `isSavedMessage(e: {origin: string; data: unknown}, origin: string, projectId: string): boolean`.

- [ ] **Step 1: Write the failing tests**: URL shape; a non-uuid id throws; `isSavedMessage` is true only for same origin, right type and this project.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and the component: a frame filling the window below the project header (`height: calc(100dvh - <header>)`, no max width), **Full screen** (Fullscreen API on the frame's wrapper), **Open in its own window** (`window.open(url, "bmd-takeoff-<id>", "popup,width=1600,height=1000")`); on a saved message, invalidate the project's estimate and takeoff queries. A text link "Open the previous takeoff screen" keeps the old tab reachable until stage 2 retires it.
- [ ] **Step 4: Run tests; verify in a browser** at 1280 and 1920 wide: the frame fills the window, both buttons work, Escape leaves full screen.
- [ ] **Step 5: Commit.**

### Task 6: BMD look, credit, and switching off what BMD replaces

**Files:**
- Create: `vendor/opentakeoff/web/src/styles/bmd-theme.css`
- Modify: `vendor/opentakeoff/web/src/main.jsx`, `components/WorkspaceChrome.jsx` or the top bar in `pages/TakeoffCanvas.jsx`, `components/PremiumInterest.jsx` call sites, the Contribute and Connect-AI entry points, `BMD-CHANGES.md`

- [ ] **Step 1:** Theme tokens set to BMD navy and blush; BMD logo in the top bar; the home screen and the workspace About line read "Built on OpenTakeoff (Apache-2.0)" linking to the project.
- [ ] **Step 2:** In a `VITE_BMD=1` build, hide: Google and Microsoft 365 sign-in and folder-link gates, "premium interest", Contribute, the browser AI-key settings, Manage plan set → Remove and Clear workspace.
- [ ] **Step 3: Verify** by text search of the built workspace in a browser: none of those entry points is reachable; the credit is visible; `bun run check:takeoff` passes.
- [ ] **Step 4:** Whole-suite run, type check, BMD build; commit; push; ask Dan to Publish; verify on the live site as Dan on "Test Take Off".
