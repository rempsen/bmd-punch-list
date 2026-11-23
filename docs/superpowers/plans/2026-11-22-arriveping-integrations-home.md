# ArrivePing Integrations Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ArrivePing a visible home in Company settings → Integrations, push install visits to ArrivePing on Schedule with a visible, retryable sync queue, and show crew status on the project.

**Architecture:** A generic `sync_events` outbox table records every outbound push and inbound webhook. A server-only ArrivePing client (Bearer key from `process.env["ArrivePing_Api"]`) is called from TanStack server functions; the browser never sees the key. The existing visit status machine and webhook stay; they gain `assigned`/`rescheduled` events and write to the outbox. UI: new Integrations tab with an ArrivePing card + Sync queue, VisitsPanel gains end date / push / badges, Site tab gains a crew-status panel.

**Tech Stack:** TanStack Start server functions, Supabase (service role on server, RLS for clients), Drizzle SQL migrations, React Query, shadcn/ui, `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-22-arriveping-integrations-home-design.md` (and project doc `specs/phase-4-arriveping-integration.md` for the wider contract).

## Global Constraints

- API key env name: `ArrivePing_Api`, fallback `ARRIVEPING_API_KEY`. Webhook secret: `ARRIVEPING_WEBHOOK_SECRET` (unchanged).
- Base URL `https://arriveping.com`; MCP endpoint `https://arriveping.com/api/mcp`; API paths are constants in one file (`src/lib/arriveping/core.ts`) — first guess `/api/v1/workorders`.
- Key never reaches the browser: all ArrivePing calls in `*.server.ts` or `*.functions.ts`; client components only call server fns.
- Scheduling a visit must succeed even when the push fails; failures are recorded, never thrown to the user as a blocked save.
- Idempotency key for a visit create is `bmd-visit-<visit_id>`; reschedule `bmd-visit-<visit_id>-reschedule-<unix ms>`; cancel `bmd-visit-<visit_id>-cancel`.
- Permission for the Integrations tab and all sync server fns: `manage_integrations` (via `has_capability` rpc, same pattern as `ms.functions.ts`). `pushVisit` additionally allowed for `manage_projects`.
- Migration numbering continues at `0044`; use `--> statement-breakpoint` between statements as existing migrations do.
- Tests: `bun test`; pure logic in `core.ts`/`logic.ts` with colocated `*.test.ts`. No network in tests (inject `fetch`).

## Review Focus

1. Key missing or misnamed → Integrations card says "Not configured — add secret `ArrivePing_Api`"; nothing throws. (Task 2 test `arrivepingKey` returns null; Task 3 status returns `configured:false`.)
2. ArrivePing returns 403 (no write scope yet) → visit saved, sync event `failed` with the error text, CSV export still offered on the project. (Task 3 `pushVisit` test with 403 fetch; Task 6 shows fallback when `lastPushFailed`.)
3. Schedule clicked twice / retry after a timeout that actually succeeded → one work order; same idempotency key reused on retry. (Task 2 `idempotencyKey` test; Task 3 retry reuses stored key.)
4. End date before start date, or a `rescheduled` webhook with `end_at < start_at` → rejected in the form; ignored by the webhook with `ignored:"bad schedule"`. (Task 4 parser test; Task 6 form validation test in `logic.test.ts`.)
5. MCP probe returns HTML/non-JSON (proxy page, 404) → "Connection failed: unexpected response", not a crash. (Task 2 `parseMcpToolsList` test.)

---

### Task 1: Outbox table and visit columns

**Files:**
- Create: `drizzle/migrations/0044_arriveping_sync.sql`
- Modify: `drizzle/migrations/meta/_journal.json` (append entry as previous migrations do)

**Interfaces:**
- Produces table `public.sync_events`:
  `id uuid pk default gen_random_uuid(), direction text check in ('out','in'), system text not null default 'arriveping', entity_type text not null, entity_id uuid, project_id uuid null references projects(id) on delete set null, event_type text not null, idempotency_key text unique, external_id text, payload jsonb not null default '{}', status text not null check in ('pending','sent','acked','failed','ignored'), attempts int not null default 0, last_error text, created_at timestamptz default now(), processed_at timestamptz`.
- Index `(system, status, created_at)` and `(project_id, created_at)`.
- RLS: enable; revoke all from anon/authenticated; `GRANT SELECT` to authenticated; policy `sync_events read` FOR SELECT USING `public.has_capability('manage_integrations') OR (project_id IS NOT NULL AND public.has_capability('view_pipeline'))`. No insert/update policies (server role only).
- `install_visits` add columns: `arriveping_status text`, `arriveping_assigned_to text`, `arriveping_last_event_at timestamptz`; extend `GRANT UPDATE` list with them.
- `install_visit_events.source` CHECK extended to `('staff','arriveping','sync')`.

- [ ] **Step 1: Write the migration** with the DDL above, mirroring the style of `0038_install_visits.sql` (DO block for RLS loop is optional; plain statements are fine).
- [ ] **Step 2: Append the journal entry** for tag `0044_arriveping_sync` matching the previous entry's shape.
- [ ] **Step 3: Verify** `bun run typecheck` still passes (no TS touches yet) and the SQL parses: `psql` is not available here, so read the file once end-to-end for unbalanced parentheses and missing breakpoints.
- [ ] **Step 4: Commit** — `git add drizzle && git commit -m "feat(arriveping): sync_events outbox and visit status columns"`.

---

### Task 2: ArrivePing core (pure) + server client

**Files:**
- Create: `src/lib/arriveping/core.ts`, `src/lib/arriveping/core.test.ts`, `src/lib/arriveping/client.server.ts`

**Interfaces (core.ts, pure, no env/network):**
- `export const AP_BASE = "https://arriveping.com"; export const AP_MCP = `${AP_BASE}/api/mcp`; export const AP_PATHS = { workorders: "/api/v1/workorders" } as const;`
- `export function pickKey(env: Record<string, string | undefined>): string | null` → `env["ArrivePing_Api"] ?? env["ARRIVEPING_API_KEY"] ?? null`, trimmed, empty → null.
- `export function idempotencyKey(kind: "create" | "cancel", visitId: string): string; export function rescheduleKey(visitId: string, nowMs: number): string` → values in Global Constraints.
- `export type VisitForPush = { id: string; starts_at: string; ends_at: string | null; crew: string | null; notes: string | null; site_contact: string | null }; export type ProjectForPush = { id: string; name: string; number: string | null; address: string | null; client: string | null; arriveping_customer_id?: string | null };`
- `export function workOrderPayload(v: VisitForPush, p: ProjectForPush): Record<string, unknown>` → `{ external_source: "bmd_projects", external_ref: v.id, title: "<number> <name> — Install", reference: number, customer_id?, site_address: { line1: address }, site_contact: { name: site_contact }, start_at, end_at: ends_at ?? start + 8h, crew_hint: crew, notes_for_crew: notes, tags: ["bmd","install"] }` (omit null fields).
- `export function parseMcpToolsList(body: unknown): { tools: string[] } | { error: string }` — accepts JSON-RPC `{ result: { tools: [{ name }] } }`; anything else → `{ error: "unexpected response" }`.
- `export function describeApiError(status: number, body: string): string` → `403` → "ArrivePing refused: the API key lacks the scope for this call (403)"; `401` → "ArrivePing rejected the API key (401)"; `404` → "ArrivePing endpoint not found (404) — check AP_PATHS"; else `"ArrivePing error <status>: <first 200 chars>"`.

**Interfaces (client.server.ts):**
- `export function arrivepingKey(): string | null` (uses `pickKey(process.env)`).
- `export async function apFetch(path: string, init: { method: "GET"|"POST"|"PATCH"; body?: unknown; idempotencyKey?: string }, fetchImpl = fetch): Promise<{ ok: true; status: number; json: unknown } | { ok: false; status: number; error: string }>` — sets `Authorization: Bearer`, `Content-Type: application/json`, `Idempotency-Key`; 15 s `AbortSignal.timeout`; network/timeout → `{ ok:false, status:0, error:"Could not reach ArrivePing: <message>" }`.
- `export async function mcpProbe(fetchImpl = fetch): Promise<{ ok: true; tools: string[] } | { ok: false; error: string }>` — POST JSON-RPC `initialize` then `tools/list` to `AP_MCP` with `Accept: application/json, text/event-stream`; parse with `parseMcpToolsList`; if the response is SSE (`text/event-stream`), take the last `data:` line.

- [ ] **Step 1: Write failing tests** in `core.test.ts`:
  - `pickKey` prefers `ArrivePing_Api`, falls back, returns null for empty/whitespace.
  - `idempotencyKey("create", id) === "bmd-visit-"+id`; `rescheduleKey(id, 1700000000000)` ends with `-reschedule-1700000000000`.
  - `workOrderPayload` for the visit fixture from `logic.test.ts` and project `{ name:"Test Take Off", number:"26-002", address:"Winnipeg, MB", client:"Brian & Gail Chornoboy" }` → `title "26-002 Test Take Off — Install"`, `external_ref` = visit id, `end_at` present, no `customer_id` key, no null values anywhere.
  - `workOrderPayload` with `ends_at:null` → `end_at` = start + 8 h ISO.
  - `parseMcpToolsList({ jsonrpc:"2.0", result:{ tools:[{name:"list_workorders"}] } })` → `{ tools:["list_workorders"] }`; `parseMcpToolsList("<html>")` → `{ error:"unexpected response" }`.
  - `describeApiError(403, "")` contains "lacks the scope".
- [ ] **Step 2: Run** `bun test src/lib/arriveping` → FAIL (module not found).
- [ ] **Step 3: Implement `core.ts`** per the interfaces.
- [ ] **Step 4: Run** `bun test src/lib/arriveping` → PASS.
- [ ] **Step 5: Implement `client.server.ts`** per the interfaces (no tests beyond typecheck; its logic is in core).
- [ ] **Step 6: Verify** `bun run typecheck` passes.
- [ ] **Step 7: Commit** — `feat(arriveping): core payload/idempotency helpers and server client`.

---

### Task 3: Outbox + server functions (status, test, push, retry)

**Files:**
- Create: `src/lib/arriveping/outbox.server.ts`, `src/lib/arriveping/arriveping.functions.ts`, `src/lib/arriveping/push.ts`, `src/lib/arriveping/push.test.ts`

**Interfaces:**
- `push.ts` (pure orchestration, injectable deps): `export async function pushVisitCreate(deps: { fetchJson: (path: string, init: { method: "POST"; body: unknown; idempotencyKey: string }) => Promise<ApResult>; visit: VisitForPush & { arriveping_job_id: string | null }; project: ProjectForPush; existingKey?: string | null }): Promise<{ outcome: "sent"; jobId: string; key: string } | { outcome: "failed"; error: string; key: string } | { outcome: "skipped"; reason: "already linked" }>`. Uses `existingKey ?? idempotencyKey("create", visit.id)`. Job id read from response `json.id ?? json.work_order?.id ?? json.data?.id` (string). `ApResult` = return type of `apFetch`.
- `outbox.server.ts` (service role `supabaseAdmin`): `recordPending(e: { direction:"out"|"in"; entity_type: string; entity_id: string|null; project_id: string|null; event_type: string; idempotency_key?: string|null; payload: unknown; external_id?: string|null }): Promise<string /*id*/>`; `markSent(id, externalId?)`, `markFailed(id, error)`, `markIgnored(id, reason)` (each bumps `attempts`, sets `processed_at`); `findPendingOrFailed(entity_type, entity_id, event_type)` → latest row or null (for retry reuse of `idempotency_key`).
- `arriveping.functions.ts` (all `.middleware([requireSupabaseAuth])`, `allowed()` copied from `ms.functions.ts`):
  - `arrivepingStatus` GET → `{ configured: boolean; canManage: boolean; webhookUrl: string; webhookSecretSet: boolean; lastOutAt: string|null; lastInAt: string|null; failedCount: number; pendingCount: number }`.
  - `arrivepingTest` POST (manage_integrations) → `mcpProbe()` result `{ ok, tools?, error? }`.
  - `listSyncEvents` GET (manage_integrations) `{ status?: "failed"|"pending"|"all"; limit?: number }` → rows (max 100, newest first).
  - `pushVisit` POST (manage_projects or manage_integrations) `{ visitId: string }` → loads visit + project via admin, calls `pushVisitCreate` with `fetchJson = apFetch`, records outbox row before the call (`pending`) and `markSent`/`markFailed` after; on `sent` updates `install_visits.arriveping_job_id`, `arriveping_status = "scheduled"` and inserts `install_visit_events { status:"scheduled", note:"Sent to ArrivePing (work order <id>)", source:"sync" }`. Returns the push outcome. If key missing → records `failed` with "ArrivePing is not configured" and returns failed (never throws).
  - `cancelVisitPush` POST (manage_projects or manage_integrations) `{ visitId }` → if the visit has `arriveping_job_id`, POST `${AP_PATHS.workorders}/${jobId}/cancel` with key `idempotencyKey("cancel", visitId)` and record the outbox row like `pushVisit`; without a job id returns `{ outcome:"skipped" }`. (Reschedule from BMD is not in this round: the panel has no edit-dates UI yet.)
  - `retrySyncEvent` POST (manage_integrations) `{ id }` → for `entity_type:"visit", event_type:"create"` re-runs `pushVisit` reusing the row's `idempotency_key`; other types → `markIgnored(id, "retry not supported yet")`.
  - `retryAllFailed` POST (manage_integrations) → runs `retrySyncEvent` for each failed row (max 50), returns counts.

- [ ] **Step 1: Write failing tests** `push.test.ts`:
  - 201 `{ id:"wo_1" }` → `{ outcome:"sent", jobId:"wo_1", key:"bmd-visit-<id>" }` and `fetchJson` was called once with `AP_PATHS.workorders` and that key.
  - 403 → `{ outcome:"failed", error: contains "lacks the scope" }`.
  - `existingKey:"bmd-visit-x"` → that key is what `fetchJson` receives.
  - visit with `arriveping_job_id:"wo_9"` → `{ outcome:"skipped" }` and `fetchJson` not called.
  - 201 with body `{ data:{ id:"wo_2" } }` → jobId "wo_2"; 201 with `{}` → `failed` with error "ArrivePing did not return a work order id".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `push.ts`**.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Implement `outbox.server.ts` and `arriveping.functions.ts`** per interfaces.
- [ ] **Step 6: Verify** `bun run typecheck` and `bun test`.
- [ ] **Step 7: Commit** — `feat(arriveping): outbox, status/test/push/retry server functions`.

---

### Task 4: Webhook — assigned & rescheduled events, inbound outbox rows

**Files:**
- Modify: `src/lib/visits/logic.ts`, `src/lib/visits/logic.test.ts`, `src/routes/api/public/arriveping/webhook.ts`

**Interfaces:**
- `parseArrivePingEvent` return type becomes `{ kind: "status"; status: VisitStatus; ... } | { kind: "assigned"; assignee: string | null; ... } | { kind: "rescheduled"; startsAt: string; endsAt: string | null; ... } | null`, keeping `jobId`, `visitId`, `at` on all. Event names: `assigned` (from `workorder.assigned`/`job.assigned`; assignee from `data.assigned_to`, `data.tech.name`, `data.assignee`), `rescheduled` (`start_at`/`starts_at`, `end_at`/`ends_at`; invalid or `end < start` → `null`).
- Existing tests keep passing with `kind:"status"` added to expectations.

- [ ] **Step 1: Extend tests** — update existing expectations to include `kind:"status"`; add: `assigned` with `data.tech.name:"Brodie"` → `{ kind:"assigned", assignee:"Brodie", jobId:"77" }`; `rescheduled` valid → `kind:"rescheduled"` with ISO strings; `rescheduled` with `end_at` before `start_at` → `null`.
- [ ] **Step 2: Run** `bun test src/lib/visits` → FAIL.
- [ ] **Step 3: Implement** parser changes in `logic.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Update `webhook.ts`**: after secret check and parse, `recordPending({ direction:"in", entity_type:"visit", entity_id: visit?.id ?? null, project_id: visit?.project_id ?? null, event_type: ev.kind === "status" ? ev.status : ev.kind, payload: body, external_id: ev.jobId })`; branch on `kind`: `status` → existing behaviour plus `arriveping_status = next.status`, `arriveping_last_event_at`; `assigned` → set `arriveping_assigned_to`, `arriveping_status = "assigned"` (only if current status is `scheduled`), event note `Assigned to <name> in ArrivePing`; `rescheduled` → update `starts_at`/`ends_at`, note `Rescheduled in ArrivePing to <local date range>`. Mark the outbox row `acked`, or `ignored` with the existing `ignored:` reasons.
- [ ] **Step 6: Verify** `bun run typecheck`; `bun test`.
- [ ] **Step 7: Commit** — `feat(arriveping): webhook handles assigned/rescheduled and logs inbound events`.

---

### Task 5: Integrations tab, ArrivePing card, Sync queue

**Files:**
- Modify: `src/lib/settings-tabs.ts`, `src/routes/_authenticated/settings.tsx`, `src/components/AppShell.tsx:67`
- Create: `src/components/settings/IntegrationsPanel.tsx`, `src/components/settings/ArrivePingCard.tsx`, `src/components/settings/SyncQueue.tsx`
- Test: `src/lib/settings-tabs.test.ts` (new)

**Interfaces:**
- `COMPANY_TABS = ["quotes", "integrations", "ai", "allusers", "roles", "projects", "jobs"]`; `export function canonicalTab(tab: string | undefined): string | undefined` → `"microsoft"` ↦ `"integrations"`, else unchanged.
- `settings.tsx`: companyTabs adds `[canMicrosoft, "integrations", "Integrations"]` and `[canMicrosoft, "ai", "AI"]`, drops `microsoft`; `tab` resolution applies `canonicalTab(search.tab)`; `<TabsContent value="integrations"><IntegrationsPanel result={search.ms} message={search.message} /></TabsContent>`, `<TabsContent value="ai"><AiModelPanel /></TabsContent>`.
- `AppShell.tsx:67`: `"microsoft"` → `"integrations"`.
- `IntegrationsPanel({ result, message })` renders, in order: `<ArrivePingCard />`, `<Microsoft365Panel result message />`, CompanyCam card (text + link to `/companycam`, same as the job tab's content), QuickBooks card (static copy: "Connected through ArrivePing — invoices are created as drafts in QuickBooks once the ArrivePing integration is live.").
- `ArrivePingCard`: uses `arrivepingStatus`, `arrivepingTest`, `retryAllFailed`. Shows: status pill (Not configured / Configured / Connected · N tools / Connection failed), key env name, webhook URL with Copy button, webhook secret set?, last push / last webhook, failed/pending counts, buttons **Test connection**, **Retry all failed**, then `<SyncQueue />`. Copy for not configured: `Add a server secret named ArrivePing_Api with the key from ArrivePing → Settings → API & MCP, then publish.`
- `SyncQueue`: table of `listSyncEvents({ status:"all", limit:50 })` columns Time · Direction · Entity · Event · Status · Attempts · Error · Retry (button calls `retrySyncEvent`, only for `failed`). Uses the `Box` styling from `Microsoft365Panel`.

- [ ] **Step 1: Write failing test** `settings-tabs.test.ts`: `canonicalTab("microsoft") === "integrations"`, `canonicalTab("ai") === "ai"`, `COMPANY_TABS` contains `"integrations"` and not `"microsoft"`, `settingsGroup("integrations") === "company"`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `settings-tabs.ts` changes.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Build the three components and wire `settings.tsx` + `AppShell.tsx`** per interfaces.
- [ ] **Step 6: Verify** `bun run typecheck`; `bun run lint`; `bun run build` succeeds.
- [ ] **Step 7: Commit** — `feat(settings): Integrations tab with ArrivePing card and sync queue`.

---

### Task 6: VisitsPanel — end date, push on Schedule, status badges, fallback export

**Files:**
- Modify: `src/components/visits/VisitsPanel.tsx`, `src/lib/visits/logic.ts`, `src/lib/visits/logic.test.ts`

**Interfaces:**
- `logic.ts`: `export function visitTimes(form: { date: string; endDate?: string; start: string; end: string }): { startsAt: Date; endsAt: Date | null } | { error: string }` — `endDate` defaults to `date`; errors: "Choose a date and start time.", "The end is before the start."; `export const AP_LABEL: Record<string,string> = { scheduled:"Scheduled", assigned:"Assigned", en_route:"On the way", arrived:"On site", completed:"Completed", cancelled:"Cancelled" }`; `export function arrivepingBadge(v: { arriveping_job_id: string|null; arriveping_status: string|null; arriveping_assigned_to: string|null }): string | null` → e.g. `"Assigned to Brodie"`, `"On the way"`, `"Scheduled in ArrivePing"`, or null when no job id.
- `Visit` type gains `arriveping_status: string | null; arriveping_assigned_to: string | null`.
- `VisitsPanel`: form gains **End date** input (defaults to date; shown always); after insert, calls `useServerFn(pushVisit)({ data:{ visitId } })` and toasts `"Visit scheduled and sent to ArrivePing."` / `"Visit scheduled. ArrivePing push failed — see Company settings → Integrations."` by outcome; each visit row shows `arrivepingBadge` and an **Open in ArrivePing** link (`${AP_BASE}/admin/workorders/${job_id}` — constant `apWorkOrderUrl(id)` in `core.ts`); a **Send to ArrivePing** button when `arriveping_job_id` is null and status is `scheduled` (calls `pushVisit`); the existing **Export for ArrivePing** button only when at least one scheduled visit has no `arriveping_job_id`; `move(v, "cancelled")` additionally calls `cancelVisitPush` (outcome toasted, never blocks the local cancel).

- [ ] **Step 1: Write failing tests** in `logic.test.ts`: `visitTimes` multi-day (`date:"2026-12-01", endDate:"2026-12-04", start:"08:00", end:"16:00"`) → ends after starts by 3 days 8 h; end before start → error text; `arrivepingBadge` three cases + null.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `logic.ts`. **Step 4: Run** → PASS.
- [ ] **Step 5: Update `VisitsPanel.tsx`** per interfaces (query selects the two new columns; `add` uses `visitTimes`).
- [ ] **Step 6: Verify** `bun run typecheck`; `bun run build`.
- [ ] **Step 7: Commit** — `feat(visits): end date, push to ArrivePing on schedule, status badges`.

---

### Task 7: Site tab crew status + timeline wording

**Files:**
- Modify: `src/routes/_authenticated/projects.$id.tsx:378-415` (SiteTab), `src/lib/projects/timeline.ts:26`
- Create: `src/components/visits/CrewStatusPanel.tsx`

**Interfaces:**
- `CrewStatusPanel({ projectId })` — reads `install_visits` (same select as VisitsPanel) and lists upcoming/active visits with `arrivepingBadge`, date range, crew, assignee, Open in ArrivePing; empty state "No install visits scheduled."
- `timeline.ts`: suffix ` · reported by ArrivePing` for `source === "arriveping"`, ` · sent to ArrivePing` for `source === "sync"`.

- [ ] **Step 1: Add a timeline test** (create `src/lib/projects/timeline.test.ts` if absent): a visit entry with `source:"sync"` renders text ending `· sent to ArrivePing`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Build `CrewStatusPanel`** and render it at the top of `SiteTab` for everyone who can see the tab.
- [ ] **Step 6: Verify** `bun run typecheck`; `bun run build`.
- [ ] **Step 7: Commit** — `feat(site): crew status panel from ArrivePing`.

---

### Task 8: Docs and hand-off

**Files:**
- Modify: `README.md` (env section), `AGENTS.md` (if it lists integrations)
- Project doc: `specs/phase-4-arriveping-integration.md` §11 build order — mark step 1 and the visit half of step 4 done.

- [ ] **Step 1:** Document `ArrivePing_Api`, `ARRIVEPING_WEBHOOK_SECRET`, the webhook URL, and where the Sync queue lives.
- [ ] **Step 2:** Run full `bun test`, `bun run lint`, `bun run typecheck`, `bun run build`.
- [ ] **Step 3: Commit** — `docs: ArrivePing integration setup` and push the branch.
