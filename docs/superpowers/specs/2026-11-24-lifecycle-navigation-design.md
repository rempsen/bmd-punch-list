# Lifecycle navigation — design (24 Nov 2026)

## Intent
Reorganize the sidebar from a feature list into the job lifecycle so the whole job is always in view: win the work → get ready → install → close out. Company-wide items sit above the current-job badge; everything below it is about one job.

## Target structure (from Dan's mockup)
WORKSPACE · ALL JOBS: Overview, Pipeline, Estimates & Quotes, Projects, Materials & Deliveries, Schedule & Crews, Installation Progress, Resources ▾ (Catalogue, Clients, Suppliers)
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
- Schedule & Crews is a read-only cross-job view of ArrivePing visits and crews; scheduling itself stays in ArrivePing.
- Takeoff, Estimate, Quotes, Billing remain tabs inside a project; the sidebar links into them for the current job.

## Release order
1 Sidebar with existing screens · 2 Overview · 3 Estimates & Quotes list · 4 Materials & Deliveries + QuickBooks PO · 5 Installation Progress · 6 Schedule & Crews · 7 Inspections & Sign-off
