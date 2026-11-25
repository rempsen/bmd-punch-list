<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## ArrivePing integration layout
- `src/lib/arriveping/`: `core.ts` (pure: paths, key lookup, mapping), `client.server.ts` (HTTP client), `outbox.server.ts` (sync queue), `push.ts` (pure push logic), `arriveping.functions.ts` (server functions called by the UI).
- `src/lib/visits/`: `logic.ts` (pure visit rules) and `data.ts` (queries).
- Inbound events: `src/routes/api/public/arriveping/webhook.ts` authenticates (integration webhooks signed in `X-ArrivePing-Signature` with the secret stored encrypted in `arriveping_link`; office alerts by `X-Webhook-Secret`) and hands off to `src/lib/arriveping/inbound.server.ts`, which also holds `reconcileVisits` (reads open linked work orders from ArrivePing and catches visits up).
- The API key never reaches the browser; all ArrivePing calls go through server functions.
## User access
- Each person has one `user_access` row: a company `level` (an `app_role`), `all_jobs`, and `status` (`active` / `deactivated`).
- `project_members` rows are job access. `role_source = 'level'` follows the person's level (the row's `role` mirrors it via trigger); `'job'` is a per-job exception that survives level changes.
- `effective_role(uid, project)` is the single rule; `is_super_admin`, `is_project_member`, `has_capability` and `my_projects` are built on it and refuse deactivated people. Don't read `project_members.role` directly for permission decisions.
- Admin writes go through `admin_*` RPCs (guards: only super admins touch super admins; no self-deactivation; the last active super admin stays). Auth bans and deletes are in `src/lib/users/users.functions.ts` (service role, server only).
- SQL tests: `bash scripts/sql-test/run.sh` (local Postgres 16, Supabase stub).
## Migrations
- Several sessions add migrations at once. Before adding one, fetch `main`. Name the file one above the highest number in `drizzle/migrations/`, and append its journal entry with `idx` = last `idx` + 1.
- When merging `main`, take main's `meta/_journal.json` and re-append only your own entries. Never add entries for files another session left out of the journal on purpose.
- `bun test src/lib/migrations-journal.test.ts` checks the files and the journal match (each file listed once, `idx` 0, 1, 2… with no repeats).
- Migrations are applied to the live database by hand, and only when Dan says so. Keep them idempotent.
## Vercel
- The Vercel project is on **Pro** (from 24 Nov 2026). PR preview builds are no longer capped at 100 a day, so a red "Vercel" status on a PR is a real build failure: read the build log and fix it, rather than waiting a day or pushing again.
- Vercel only builds previews. Production publishes through Lovable.

## Bill editing
- Fixed-price and open-book bill lists share BillEditor; draft writes use a job-authorized transactional RPC so issue, totals, over-billing confirmation and Activity remain consistent.
- Editor and invoice PDF share billing/editor.ts totals; legacy invoices retain saved totals, while edited invoices store their GST rate and detailed line quantities/prices.
