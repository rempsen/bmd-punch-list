# Lifecycle navigation — design (24 Nov 2026)

## Intent
Reorganize the sidebar from a feature list into the job lifecycle so the whole job is always in view: win the work → get ready → install → close out. Company-wide items sit above the current-job badge; everything below it is about one job.

## Target structure (from Dan's mockup)
WORKSPACE · ALL JOBS: Overview, Pipeline, Estimates & Quotes, Projects, Resources ▾ (Catalogue, Clients, Suppliers)
MATERIALS & INSTALL: Materials ▾ (Ordering, Receiving, To site), Scheduling ▾ (Technicians, Work orders, Tasks), Installation Progress
CURRENT JOB: job badge, Switch job, Job settings
POST-INSTALLATION: Closeout Overview, Deficiencies ▾ (Board, Floors, List, Summary, Add a deficiency, Exports), Remedial Work, Billing & Holdback, Inspections & Sign-off
Job Records ▾: Documents, Job photos, Email intake, Activity
Bottom: Settings (company), user

## Decisions
- Delivery approach B: a menu entry appears only when its screen is real. No placeholders.
- Accordion children are indented so they visibly belong to their header. Open/closed state is remembered per accordion in this browser.
- Installation Progress: status per area × scope, entered by hand AND pre-filled from ArrivePing — a visit records which areas it covers; when ArrivePing reports the work order complete those areas become Complete.
- Materials & Deliveries: when a project moves to Won, every material line on the accepted estimate becomes an order line at "On order"; a matching purchase order is created and sent in QuickBooks (first QuickBooks write). Statuses: On order → Received (warehouse, Thomas) → On site. An area whose material is not On site shows "Awaiting material" in Installation Progress.
- Billing sits between Remedial Work and Inspections & Sign-off. Sign-off is what releases the holdback invoice.
- Schedule & Crews is a read-only cross-job view of ArrivePing visits and crews; scheduling itself stays in ArrivePing. (Superseded by the next line.)
- Scheduling in BMD creates install visits/work orders and assigns technicians through ArrivePing; ArrivePing remains the system that runs the day.
- Materials (release 4): order lines are seeded by a database trigger when a project enters Won (accepted quote's version, else the base estimate), and appended by a trigger when a change order is accepted (`change_order_seed_materials`). Only required material components are seeded. QuickBooks POs are created and emailed from the Ordering tab, one supplier at a time, not automatically on Won.
- Takeoff, Estimate, Quotes, Billing remain tabs inside a project; the sidebar links into them for the current job.
- Scheduling (release 5): a visit carries a technician (a BMD field person, or a typed name for a subcontractor), a scope, the rooms it covers and a task checklist. ArrivePing's API takes work-order create and cancel from BMD but no assignment, so a technician change is stored in BMD, queued in the sync outbox (kind `arriveping_assignment`) and shown as "Pending in ArrivePing" until ArrivePing reports the same person as assigned.
- Technicians are BMD field staff plus crew names ArrivePing has reported on visits; there is no technicians table.
- One visit per day in the visit drawer (ArrivePing's 24-hour work-order cap); multi-day work is one visit per day. Editing a visit already in ArrivePing does not re-send its time — ArrivePing's reschedule from BMD is not wired yet.

- Installation Progress (release 6) decisions:
  - Progress is stored per room × scope (`area_progress`), created only when someone changes it; no row means Not started.
  - Scopes are the job's wizard scopes; otherwise install categories guessed from the base estimate's lines (adhesive, underlay, prep and other excluded); otherwise "flooring".
  - ArrivePing pre-fill runs on both the webhook and the catch-up check: en route / on site moves Not started rooms to In progress, complete moves them to Complete. It never downgrades and never touches Complete or Not required. The visit's free-text scope is matched to a job scope by key or label; a job with one scope uses it; otherwise nothing is pre-filled.
  - "Awaiting material" is job-wide: any material line for the job not yet On site blocks every room that still has work left (material lines are not tied to rooms). Shown, never stored.
  - A room's blocker is one note per room (saved on the job's first scope); Clear removes it from every scope.
  - Tiles: Ready to install = Not ready rooms (nothing blocking, nothing started); In progress; Blocked. Installed rooms are not counted in a tile.
  - Editing needs capture_items or manage_projects on the job; viewing needs view_dashboard or view_pipeline.

- Inspections & Sign-off (release 7) decisions:
  - A current-job screen at /signoff (Post-installation, after Billing). Viewing needs view_dashboard or manage_projects on the job; creating inspections, recording sign-off and filing PDFs need manage_projects; releasing holdback also needs view_pricing.
  - Checklist = one item per room × job scope, skipping scopes marked Not required in Installation Progress. Items also carry project_id so access rules stay simple.
  - Closing: Passed when nothing is deficient; Passed with items when every deficient item has a deficiency; otherwise closing is refused unless the user marks it Failed.
  - Sign-off needs the latest closed inspection to be Passed or Passed with items. Only one signed sign-off counts per job (the newest).
  - Emailed link: creates a pending sign-off row (its id is the link token), valid 14 days, sent through the existing Resend mailer. /sign/$token sits behind normal sign-in; the client signs through a database function that checks job membership, expiry and that it is unsigned. A failed email deletes the pending row.
  - On paper: the scan uploads to Documents → Contract and is linked to the sign-off.
  - Release holdback creates a draft holdback-release bill through the same create_progress_bill function the Billing tab uses, for all holdback currently held (held only builds up from issued progress bills). Drafts only; never issued automatically. Holdback 0% or nothing held → message, no bill.
  - The sign-off PDF downloads and, for managers, is filed to Documents → Contract (so the OneDrive mirror copies it).
  - Inspection closed / sign-off recorded / holdback released appear on the project Activity tab. Closeout Overview (/dashboard) has no timeline today, so they are not shown there.

## Release order
1 Sidebar with existing screens · 2 Overview · 3 Estimates & Quotes list · 4 Materials + QuickBooks PO · 5 Scheduling (Technicians, Work orders, Tasks) · 6 Installation Progress (built) · 7 Inspections & Sign-off (built)
