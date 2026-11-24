# User administration: design

**Status:** awaiting Dan's approval · **Date:** 2026-11-24

## Why

BMD Projects needs one place where an admin can add a person, give them a permission level, change it, and take access away, without visiting each job first. Today:

- Access is set job by job. Each `project_members.role` is one of Super admin, BMD manager, BMD field, Tradesperson, Client or Viewer, with capabilities from `role_permissions`.
- Only super admin is global (`user_roles`).
- Invites are per job.
- "All users" can only toggle super admin.
- Nobody can be removed from the system.

The goal is a polished admin area that BMD staff, trades and clients can all be managed from.

## Goals

- **Add a person.** Enter their name, email and company. Choose a **company level**, which is one of the six existing roles, and choose **job access**: *All jobs* or *Selected jobs*. They get an email invite.
- **Change a person's access** in one step: their level, their job access, and per-job exceptions.
- **Deactivate a person.**
  - Sign-in is blocked at once and any open sessions end.
  - All job access is set aside, not deleted.
  - Their name stays on past records.
  - **Reactivate** restores everything exactly as it was.
- **Delete permanently**, as a separate second step. It is offered only for a deactivated person with no records, or someone who never signed in.
- See everyone at a glance: status (Active, Invited, Deactivated), level, job access and last sign-in. Search and filter the list.

## Non-goals

- Changing what each role can do. That stays in **Roles**.
- Self-service sign-up, SSO and MFA. MFA is a separate open item.
- Multiple companies or tenants.

## Anti-goals

These would be failures even if everything else works:

- A deactivated person can still read anything. Every database check must refuse them, not just the screens.
- A non-super-admin can make someone a super admin, or change or deactivate a super admin.
- Anyone can deactivate or delete themselves, or the last active super admin.
- Past records lose their author.

## Decisions (Dan's)

1. **Company-wide level** plus job access, with optional per-job exceptions.
2. **Deactivate first; delete permanently as a separate step.**
3. **Approach A** for how the level reaches jobs. See below.

## Approaches considered

- **A. Company level is the default; job roles are exceptions. Chosen.**
  - When a job-level check runs, it uses the person's role on that job if they have one. Otherwise it uses their company level, provided their access is *All jobs*.
  - New jobs work automatically, and one edit changes a person everywhere.
  - The change sits in the two central database functions every rule already uses: `is_project_member` and `has_capability`.
- **B. Copy the level onto every job.** Rejected. The copies drift, a level change rewrites every job, and deliberate exceptions can be overwritten.
- **C. One company role, no per-job roles.** Rejected. It drops the per-job override Dan wants kept.

## How it works

### Data

New table `user_access`, one row per person:

| Column | Notes |
|---|---|
| `user_id` | Primary key, references `profiles` |
| `level` | `app_role`, one of the six roles |
| `all_jobs` | boolean |
| `status` | `active` or `deactivated` |
| `deactivated_at`, `deactivated_by` | Set on deactivation |
| `updated_at`, `updated_by` | Audit |

- **Job exceptions and *Selected jobs* membership** stay in `project_members`. A row there means "this person is on this job with this role". For a person with *All jobs*, a row is an exception that overrides their level on that job.
- **Super admin** continues to use `user_roles`. In the UI it appears as the level "Super admin", and the two are kept in step by the RPCs.
- **Backfill:**
  - Every existing profile gets a row.
  - Super admins get `level = super_admin` and `all_jobs = true`.
  - Everyone else gets `all_jobs = false`, with their most-privileged current job role as their level. Chuck Rempsen becomes Tradesperson on Selected jobs, keeping Hyatt Centric.
  - No one's effective access changes.
- **Invites** gain `level` and `all_jobs`. `project_id` becomes optional, and an invite carries a list of job IDs instead of one job. `handle_new_user` writes the `user_access` row and job memberships on first sign-in.

### Permission checks (the core change)

- `is_active(uid)` returns false for deactivated people. It is checked first in `is_super_admin`, `is_project_member` and `has_capability`, so every existing rule refuses a deactivated person.
- `is_project_member(p)` means: super admin, **or** a `project_members` row, **or** (`all_jobs` and active).
- `has_capability(cap, p)` uses the role on that job if a `project_members` row exists, otherwise the company level when `all_jobs` is set.
- `my_projects()` returns the effective role per job by the same rule.
- The four policies and seven app queries that read `project_members` directly are moved onto these functions, so the rule lives in one place.

### Deactivate, reactivate, delete

These run as server functions using the service role. They are allowed only for super admins, and for `manage_users` holders acting on non-super-admins.

- **Deactivate:**
  - Set `status = deactivated` and ban the user in Supabase Auth (`ban_duration`), which ends their sessions.
  - Open invites for that email are cancelled.
  - Job rows are kept but ignored while deactivated.
  - Refused for yourself and for the last active super admin.
- **Reactivate:** lift the ban, set `status = active`, and everything returns.
- **Delete permanently:**
  - Only when the person is deactivated and owns no records: no items, photos, comments, decisions or activity rows, checked by one `user_has_records(uid)` function.
  - Removes the auth user, the profile, `user_access` and memberships.
  - Asks the admin to type the person's name to confirm.
  - Otherwise the button explains why deletion isn't available and points to deactivation.

### Screens

**Company settings → Users** replaces "All users".

```
Users                                              [ + Add user ]
[Search name, email, company]  Status: All ▾  Level: All ▾
───────────────────────────────────────────────────────────────
Dan Rosenblat   BMD Materials   Super admin   All jobs   Active · today
Brian           BMD Materials   Super admin   All jobs   Active · Sep 29
Chuck Rempsen   Rempsen Int.    Tradesperson  1 job      Active · Sep 24
Jane Doe        —               Client        2 jobs     Invited · resend
```

- **Add user** is a drawer with these fields:
  - name, email, company;
  - level, as cards with one-line descriptions from Roles;
  - job access: *All jobs* or *Selected jobs*, with a job picker and an optional role per job;
  - "Send invite email" (on by default).
  - Before sending, it summarises the result: "Jane will be a Client on Hyatt Centric and Test Take Off."
- **Person page** (drawer) has:
  - the profile;
  - level, with a short summary of what that level can and can't do;
  - job access and exceptions;
  - invite status, with Resend and Copy link;
  - last sign-in;
  - **Deactivate** and **Reactivate**;
  - **Delete permanently**, behind a confirmation.
- **Users on this job** (job settings) stays as it is, but shows where each person's access comes from: "Company level (All jobs)" or "Set on this job". Adding someone there creates a *Selected jobs* exception.
- **Who sees it:** the screen is shown to super admins and `manage_users` holders. Super admin as a level, and actions on super admins, are shown only to super admins.

### Email

Uses the existing `invite-email.server.ts` (Microsoft 365). An invite with several jobs, or with *All jobs*, gets one email that lists the access.

## Constraints

- AGENTS.md rules apply: no rewriting published history; migrations are applied only with Dan's OK; Dan merges and publishes.
- Secrets never reach the browser. The auth admin API (ban and delete) runs server-side only.
- Mobile-first touch targets (44px or more) and the existing shadcn styling, as on the other settings panels.

## Left to the builder (my calls; Dan can override)

- Search covers name, email and company. Filters are Status and Level.
- "Most-privileged role" for the backfill uses the order super_admin > bmd_manager > bmd_field > client > trade > viewer.
- A deactivated person's open invites are cancelled, not kept.
- The audit trail goes in a `user_admin_log` table recording who did what and when, shown on the person page.
