# ArrivePing in the menu — Option 1: Integrations home + live status in place

Date: 2026-11-22 · Status: proposed · Follows: project doc `specs/phase-4-arriveping-integration.md`

## Intent

Make ArrivePing a first-class, visible part of BMD Projects without staff ever leaving the screens they already use. Today the app only *receives* from ArrivePing (a webhook that moves install visits through en route → arrived → completed) and hands visits over by CSV export. After this change, staff see whether ArrivePing is connected, Schedule pushes the visit to ArrivePing when it can, and crew status shows on the project.

Why now: the BMD tenant API key is in place (`ArrivePing_Api`) and Phase 4 of the platform plan starts with exactly this plumbing.

## Goals

- One place to see and manage every integration: **Company settings → Integrations** (ArrivePing, Microsoft 365, CompanyCam, QuickBooks-via-ArrivePing).
- ArrivePing card shows: connected / not connected, key name and scopes, last successful call, webhook URL to paste into ArrivePing, Test connection, and a Sync queue of failed or pending pushes.
- **Schedule** on a project creates the ArrivePing work order via the API when the key has write scope; stores the returned ID on the visit.
- Project **Overview** card and **Site** tab show ArrivePing status (Scheduled · Assigned to … · On the way · On site · Completed) and "Open in ArrivePing".
- Install visits gain an **End date** so multi-day installs (Tue 08:00 → Fri 16:00) are one work order.

## Non-goals (this round)

- No cross-project Dispatch board (that is Option 2).
- No customer / punch-list / invoice sync yet; the client, deficiency and billing flows from the Phase 4 spec land in later rounds on the same plumbing.
- No HMAC webhook signing until ArrivePing ships it; the existing `X-Webhook-Secret` check stays.

## Anti-goals

- Never put the API key in the browser. All ArrivePing calls go through server functions / API routes.
- Never silently drop a failed push. Failures must be visible in the Sync queue with a retry.
- Never block scheduling because ArrivePing is down or lacks scope: the visit still saves; the push is queued and the card says so.

## Constraints found in the code

- Server env already pattern: `process.env["COMPANYCAM_API_TOKEN"]` etc. in TanStack Start server routes/functions. ArrivePing key is `process.env["ArrivePing_Api"]`.
- Existing: `install_visits` (starts_at, ends_at, crew, notes, site_contact, arriveping_job_id, status), `install_visit_events`, `src/lib/visits/logic.ts` (status machine, webhook parser, CSV), `VisitsPanel.tsx`, `/api/public/arriveping/webhook`.
- Settings tabs are declared in `settings.tsx` + `src/lib/settings-tabs.ts` (`COMPANY_TABS`, `JOB_TABS`); the sidebar's Company settings link opens the first allowed company tab.
- Permission `manage_integrations` already exists (used for the Microsoft tab).
- ArrivePing today exposes only read scopes for work orders/techs; the create call may 403 until the new scopes ship (requested in the project doc). The MCP endpoint (`https://arriveping.com/api/mcp`) is live and authenticates with the same key.

## Approaches considered

1. **Integrations home + status in place** — chosen. Smallest change that makes ArrivePing visible and useful everywhere staff work; everything else in Phase 4 hangs off it.
2. **Top-level Dispatch screen first** — deferred to Option 2; needs ArrivePing read endpoints/MCP tools for cross-project work-order lists, and the write scopes for actions.
3. **Keep CSV export, add only a settings card** — rejected; doesn't move the two-way sync forward.

## Design

### Settings
- Add company tab `integrations` ("Integrations"), visible with `manage_integrations`; move the Microsoft 365 panel into it and point the old `microsoft` tab at it (redirect, so bookmarks keep working). AI model stays under a renamed `ai` tab ("AI").
- CompanyCam panel is shown in Integrations too (company-level token) while the per-job CompanyCam linkage stays under Job settings.
- `IntegrationsPanel` renders cards: ArrivePing, Microsoft 365, CompanyCam, QuickBooks (via ArrivePing: shows "connected through ArrivePing" when ArrivePing reports a QuickBooks link, otherwise "not yet").

### ArrivePing card
- Status from server fn `arrivepingStatus()`:
  - configured: key present?
  - connection: MCP `initialize` + `tools/list` with the Bearer key → ok / 401 / network error; tool names are shown as the effective capabilities (this is the only scope introspection available today).
  - webhook URL: `${origin}/api/public/arriveping/webhook`; whether `ARRIVEPING_WEBHOOK_SECRET` is set.
  - last successful push / last webhook received (from `sync_events`).
- Buttons: **Test connection**, **Copy webhook URL**, **Retry all failed**.
- Sync queue table: time, entity, event, status, attempts, last error, Retry.

### Data
- New table `arriveping_sync_events` (direction, entity_type, entity_id, event_type, idempotency_key unique, payload jsonb, status pending|sent|acked|failed, attempts, last_error, created_at, processed_at). Drizzle migration + RLS: readable by `manage_integrations`, written by server only.
- `install_visits`: `arriveping_status text`, `arriveping_assigned_to text`, `arriveping_last_event_at timestamptz` (ends_at already supports multi-day; the UI gains an end date).

### Outbound push
- `src/lib/arriveping/client.server.ts`: thin fetch wrapper (base URL `https://arriveping.com`, Bearer key, `Idempotency-Key`, JSON errors → typed result). Endpoints are configurable constants so they can be corrected once ArrivePing publishes its OpenAPI; first guess `POST /api/v1/workorders` per the requirements brief.
- Server fn `pushVisit(visitId)`: writes a `pending` sync event, calls the API, stores `arriveping_job_id` and marks `sent`; on 401/403/5xx marks `failed` with the error text. Schedule calls it after insert; Reschedule calls `PATCH`; Cancel calls cancel. Retry from the Sync queue re-runs the same event with the same idempotency key.
- The CSV export stays as a fallback button when the last push for the project failed with 403 (no write scope yet).

### Inbound
- Webhook handler also records a `sync_events` row (direction in) and fills `arriveping_assigned_to` from `assigned`/`tech` fields when present; parser extended for `assigned`, `rescheduled` (updates starts_at/ends_at) alongside the existing statuses.

### Project UI
- Overview Install visits card: End date field; per visit an ArrivePing badge (status + assignee) and "Open in ArrivePing" when a job id exists; a small "Not sent to ArrivePing — retry" link when the last push failed.
- Site tab: a "Crew status" panel listing visits with live status (same data, read-only).
- Activity: already receives webhook events; outbound pushes add "Sent to ArrivePing" entries.

## Left to the builder
- Exact ArrivePing endpoint paths and payload field names (constants; adjust on first 404/422 and note in the Sync queue error).
- Card visuals follow the existing settings panels (Microsoft365Panel) — no new design language.
- Tests: `logic.test.ts` extended for the new parser events and the idempotency key; a server-fn test for `pushVisit` against a mocked fetch.
