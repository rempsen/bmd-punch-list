# User Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company-level user admin in BMD Projects. Admins can add people with a permission level and job access, change their access, deactivate and reactivate them, and delete them permanently when that's safe.

**Architecture:** A new `user_access` table holds each person's company level, an all-jobs flag and a status. `project_members` rows gain `role_source`: `level` means the person follows their company level on that job; `job` is a per-job exception. One SQL function, `effective_role(uid, project)`, decides access. `is_super_admin`, `is_project_member`, `has_capability` and `my_projects` are rebuilt on it, so every existing RLS rule inherits both the new behaviour and the deactivation lock. Auth bans and deletes run in server functions with the service role.

**Tech Stack:** Postgres (Supabase) migrations via drizzle journal, TanStack Start server functions, React + shadcn, bun test, psql for SQL tests against local Postgres 16.

**Spec:** `docs/superpowers/specs/2026-11-24-user-admin-design.md`

## Global Constraints

- Migrations: new file `drizzle/migrations/0053_user_admin.sql`, registered in `meta/_journal.json`. Applied only with Dan's OK.
- Never rewrite published git history. Dan merges and publishes.
- Service-role keys and the auth admin API stay server-side.
- Touch targets must be 44px or more (`h-11`), using the existing shadcn components and Canadian English copy.
- Levels are the existing `app_role` values: super_admin, bmd_manager, bmd_field, trade, client, viewer.
- Nobody can deactivate or delete themselves or the last active super admin. Only super admins can grant, change, deactivate or delete a super admin.
- Delete permanently is allowed only when the person is deactivated and `user_has_records(uid)` is false.
- On day one, nobody's effective access changes.

## Review Focus

1. **A deactivated user calling any RPC or table directly** must get nothing back, not just a hidden screen. This is pinned by the SQL test: `has_capability`, `is_project_member` and `my_projects` all return false or empty for a deactivated user.
2. **A per-job exception must survive a change of level.** If someone has `job` as the role source and their level changes, their role on that job stays the same. This is pinned by the SQL test.
3. **Staff assignment (`set_project_job_role`) must not create accidental exceptions.** Rows it inserts get `role_source = 'level'`. This is pinned by the SQL test.
4. **A BMD manager must not be able to promote themselves or anyone else to super admin, or touch a super admin.** This is pinned by the SQL test, which checks `admin_save_user` raises an error.
5. **Invites to several jobs or to all jobs** must land correctly on first sign-in through `handle_new_user`. This is pinned by the SQL test.

---

### Task 1: Migration 0053: schema, backfill, permission core, admin RPCs

**Files:**
- Create: `drizzle/migrations/0053_user_admin.sql`
- Modify: `drizzle/migrations/meta/_journal.json`
- Create: `scripts/sql-test/stub.sql`, a minimal Supabase stub: `auth` schema, `auth.uid()` read from `request.jwt.claim.sub`, `auth.users`, and the public tables the migration touches, with the columns they really have.
- Create: `scripts/sql-test/user-admin.test.sql`
- Create: `scripts/sql-test/run.sh`, which creates a scratch database, loads the stub, then 0053, then the test, with `ON_ERROR_STOP`.

**Interfaces (Produces):**
- Table `user_access(user_id uuid pk → profiles, level app_role not null, all_jobs bool not null default false, status text check in ('active','deactivated') default 'active', deactivated_at timestamptz, deactivated_by uuid, updated_at timestamptz default now(), updated_by uuid)`. RLS on, select for `manage_users` holders, no direct writes.
- Table `user_admin_log(id, user_id, actor, action text, detail jsonb, at timestamptz)`. RLS select for super admins and `manage_users` holders.
- `project_members.role_source text not null default 'job' check in ('level','job')`.
- `user_invites`: add `level app_role`, `all_jobs boolean default false`, `project_ids uuid[] default '{}'`.
- `is_active(uid) → bool`
- `effective_role(uid, project) → app_role | null`
- `user_has_records(uid) → bool`: dynamic scan of every public uuid column named `created_by`, `created_by_user`, `uploaded_by`, `decided_by`, `assigned_to`, `changed_by`, `added_by`, `invited_by`, `verified_by` or `user_id`, excluding the tables `user_access`, `user_admin_log`, `project_members`, `user_roles`, `profiles`, `user_invites` and `ms_connections`.
- RPCs for super admins and `manage_users` holders, with security definer and guards:
  - `admin_list_users()` returns `(id, email, full_name, company, level, all_jobs, status, is_super, last_sign_in_at, job_count, invited_at, invite_status, has_records)`.
  - `admin_user_jobs(_user) → (project_id, name, role, role_source)`.
  - `admin_save_user(_user uuid, _full_name text, _company text, _level app_role, _all_jobs bool, _jobs jsonb)`. `_jobs` is `[{project_id, role|null}]`, where `null` means follow the level. It replaces the person's membership set.
  - `admin_invite(_email, _full_name, _company, _level, _all_jobs, _jobs jsonb) → uuid` returns the invite id and refuses an existing account.
  - `admin_set_status(_user uuid, _status text)` changes the table state only; the auth ban happens in Task 3.
  - `admin_delete_user_data(_user uuid)` removes access, membership, role and profile rows once the checks pass.
- Rewritten: `is_super_admin` (adds `AND is_active`), `is_project_member`, both `has_capability`, `my_projects`, `project_people`, `project_directory`, `bmd_staff`, `set_project_job_role`, `create_job` and `create_pipeline_project` (creator membership with `role_source='level'`), `handle_new_user`, `list_users` (excludes deactivated people from job lists), and the policies "profiles read scoped" and "perms read own roles".

- [ ] **Step 1: Write the stub and failing SQL test.** `user-admin.test.sql` sets `request.jwt.claim.sub` per actor and uses `DO` blocks with `ASSERT`. It covers:
  - Backfill: a super admin becomes level super_admin with all jobs; a trade member becomes level trade with selected jobs and keeps their job.
  - An all-jobs `bmd_manager` sees a newly inserted project, and `has_capability('manage_estimates', p)` is true.
  - A per-job exception with role `viewer` on that project wins over the level, and it survives `admin_save_user` changing the level to `bmd_field` when the job is passed with role `viewer`.
  - After `admin_set_status(u,'deactivated')`: `has_capability`, `is_project_member` and `is_super_admin` are false and `my_projects()` is empty. After reactivation, everything is restored.
  - A manager calling `admin_save_user` to set `_level => 'super_admin'` raises an error. So does deactivating a super admin, deactivating yourself, and deactivating the last active super admin.
  - `admin_delete_user_data` raises an error while the person is active, and also when `user_has_records` is true. It succeeds for a deactivated person with no records.
  - `admin_invite` with two jobs, followed by inserting `auth.users` with that email, creates a `user_access` row with the invited level and two `role_source='level'` memberships.
  - `set_project_job_role` for an all-jobs manager inserts a row with `role_source='level'`.
- [ ] **Step 2: Run `bash scripts/sql-test/run.sh`.** Expected: FAIL, because 0053 doesn't exist.
- [ ] **Step 3: Write `0053_user_admin.sql`.**
  - Backfill: give every profile a `user_access` row. Super admins get super_admin with all jobs. Everyone else gets their most privileged member role, in the order super_admin > bmd_manager > bmd_field > client > trade > viewer, defaulting to viewer, with selected jobs.
  - Set existing `project_members.role_source` to `'level'` where the role equals the person's new level, otherwise `'job'`.
  - Add a trigger on `profiles` insert that creates a default `user_access` row with level viewer, if none exists.
  - Each admin RPC writes a `user_admin_log` row.
  - Register the migration in the journal.
- [ ] **Step 4: Run `bash scripts/sql-test/run.sh`.** Expected: all `ASSERT`s pass and the output ends with "user-admin SQL tests passed".
- [ ] **Step 5: Commit.**

### Task 2: Pure user-admin logic

**Files:**
- Create: `src/lib/users/logic.ts`
- Create: `src/lib/users/logic.test.ts`

**Interfaces (Produces):**
- `type AdminUser` mirrors the rows from `admin_list_users`.
- `userStatus(u) → "active" | "invited" | "deactivated"`. A user with an invite who has never signed in counts as invited.
- `accessSummary(level, allJobs, jobs: {name, role|null}[]) → string`, for example "Client on Hyatt Centric and Test Take Off", "BMD manager on all jobs", or "Tradesperson on 3 jobs (Viewer on Hyatt Centric)".
- `canAct(actor: {id, isSuper}, target: AdminUser, action: "edit"|"deactivate"|"reactivate"|"delete", activeSuperCount: number) → {ok: true} | {ok: false, why: string}`.
- `filterUsers(users, {q, status, level}) → AdminUser[]`, matching name, email or company without regard to case.
- `levelsFor(actorIsSuper) → AppRole[]`. Only super admins see `super_admin`.

- [ ] **Step 1: Write tests**:
  - The summary strings above.
  - `canAct` refuses self-deactivation with "You can't deactivate yourself".
  - `canAct` refuses the last super admin with "BMD needs at least one active super admin".
  - `canAct` refuses a non-super acting on a super admin with "Only a super admin can change a super admin".
  - `canAct` refuses deleting someone with records with "Has records on jobs; keep them deactivated".
  - `canAct` refuses deleting an active person with "Deactivate first".
  - `filterUsers` finds by company and filters by status.
- [ ] **Step 2: Run `bun test src/lib/users`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `bun test src/lib/users`.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: Server functions for invite, resend, deactivate, reactivate and delete

**Files:**
- Create: `src/lib/users/users.functions.ts`
- Modify: `src/lib/invite-email.server.ts`, adding an `accessInviteEmail({..., accessLine})` variant whose subject is "You're invited to BMD Projects".

**Interfaces:**
- Consumes the Task 1 RPCs and `canAct` from Task 2.
- Produces these server functions, each with `requireSupabaseAuth`:
  - `inviteUser({email, fullName, company, level, allJobs, jobs, send}) → {inviteId, email: SendResult|null}`
  - `resendUserInvite({inviteId})`
  - `deactivateUser({userId})`, which calls the RPC as the caller (guards apply) and then `supabaseAdmin.auth.admin.updateUserById(id, {ban_duration: "876000h"})`. If the ban fails, it rolls the status back and throws.
  - `reactivateUser({userId})`, the same in reverse, using `ban_duration: "none"`.
  - `deleteUser({userId, confirmName})`. The name must match `full_name ?? email` case-insensitively. It calls `admin_delete_user_data` and then `supabaseAdmin.auth.admin.deleteUser(id)`.

- [ ] **Step 1:** Extract the guard logic that has no I/O, `validateInvite(input)`, into `logic.ts` and test it: the email format, a level from the list, at least one job unless all jobs is set, and job IDs as UUIDs.
- [ ] **Step 2:** Run the tests. Expected: FAIL, then implement until they PASS.
- [ ] **Step 3:** Implement the server functions. Run `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 4: Commit.**

### Task 4: Users admin screen, add drawer and person drawer

**Files:**
- Create: `src/components/settings/users/UsersAdmin.tsx` (list, search, filters, Add button)
- Create: `src/components/settings/users/AddUserSheet.tsx`
- Create: `src/components/settings/users/PersonSheet.tsx`
- Create: `src/components/settings/users/LevelPicker.tsx` (cards from `ROLES`)
- Create: `src/components/settings/users/JobAccessPicker.tsx` (All jobs or Selected jobs, a job checklist, and a per-job role select defaulting to "Company level")
- Modify: `src/routes/_authenticated/settings.tsx`. The `allusers` tab becomes "Users", shown when `isSuperAdmin || canAny("manage_users")`, and renders `UsersAdmin`.
- Modify: `src/components/settings/UsersPanel.tsx`. Remove `AllUsersPanel`. On the job tab, show each person's access source ("Company level" or "Set on this job") from `admin_user_jobs` or `list_users`.
- Modify: `src/integrations/supabase/types.ts` (new tables, columns and RPCs).

**Interfaces:** Consumes the Task 2 and Task 3 functions and the Task 1 RPCs.

- [ ] **Step 1: Build the list.** Each row shows name, email, company, a level badge, the job-access text, status with a coloured dot, and last sign-in. It gets an empty state and a loading skeleton.
- [ ] **Step 2: Build the Add drawer.** It checks its fields with `validateInvite`. A summary line above the button reads like "Jane Doe will be a Client on Hyatt Centric". On success it shows a toast, and on an email failure it offers a copy-link fallback.
- [ ] **Step 3: Build the Person drawer.**
  - Edit the profile, level and job access, then Save, which calls `admin_save_user`.
  - Invite block: Resend, plus a Copy link built from the invite token.
  - Status block: Deactivate or Reactivate, using an AlertDialog that explains what happens.
  - Danger zone: Delete permanently, with a typed-name confirmation. The button is disabled with the `canAct` reason when deletion isn't allowed.
  - An activity log from `user_admin_log`.
- [ ] **Step 4:** Run `npx tsc --noEmit` and lint the changed files. Expected: clean.
- [ ] **Step 5: Commit.**

### Task 5: Docs and the full check

**Files:** `AGENTS.md`, which gets a "User access" section covering `user_access`, `role_source` and `effective_role`.

- [ ] **Step 1:** Run the full `bun test`. Expected: everything passes except the 2 OpenTakeoff failures that already fail on main.
- [ ] **Step 2:** Run `bash scripts/sql-test/run.sh`. Expected: pass.
- [ ] **Step 3:** Commit, push the branch, and open a PR.
