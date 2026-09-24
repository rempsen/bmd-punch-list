# BMD Punch

Build "BMD Deficiency Tracker" — a mobile-first construction deficiency (punch list) tracking app for BMD Materials, a flooring and tile contractor. First job: the Hyatt Centric hotel. Site crews use iPhones (Safari, add-to-home-screen), so the capture flow must be thumb-friendly with large tap targets; office users and the client use desktop.

## Backend
Use Lovable Cloud (Supabase): Postgres, Auth (email/password), and Storage for photos. Enable Row Level Security. Roles stored in a `user_roles` table (never on the profile): `bmd_admin`, `bmd_field`, `client`. Users are invited by an admin; the first signed-up user becomes bmd_admin.

## Data model
- `projects` (id, name, client_name, address, created_at). Seed one: "Hyatt Centric" (client "Hyatt Centric / GC").
- `floors` (id, project_id, number int, label text, sort_order).
- `locations` (id, floor_id, type enum: 'room' | 'common_area', name text e.g. "1204" or "Corridor – East", room_type text nullable e.g. King/Double/Suite). Rooms and corridors are both locations.
- `pick_lists`: three editable lists, seeded as follows.
  - Area: Entry / vestibule; Main room; Closet; Bathroom – shower walls; Bathroom – vanity wall; Bathroom – general wall tile; Bathroom – floor; Corridor; Other.
  - Material: Vinyl plank; Floor tile; Wall tile; Carpet; Wall base; Transition / trim; Grout & caulk.
  - Issue type: Lippage; Chipped / cracked; Hollow tile; Grout inconsistent / missing; Caulking missing or poor; Exposed cut edge; Gap / open joint; Scratched / gouged; Lifting / peaking; Stain / discoloration; Layout / pattern misaligned; Missing piece; Visible seam; Loose base; Other.
- `deficiencies` (id, project_id, item_number auto-incrementing per project displayed as D-0001, location_id, area, material, issue_type, description text, assessment enum: 'acceptable' | 'client_review' | 'must_fix', status enum: 'open' | 'awaiting_client' | 'accepted_as_is' | 'fix_required' | 'in_progress' | 'fixed' | 'verified', assigned_to uuid nullable, due_date nullable, client_decision_note text nullable, created_by, created_at, updated_at, closed_at).
- `deficiency_photos` (id, deficiency_id, storage_path, kind enum 'before' | 'after', caption, taken_at, uploaded_by). Multiple photos per item; compress client-side to ~1600px max before upload.
- `deficiency_events` (id, deficiency_id, user_id, event_type, from_value, to_value, note, created_at) — an audit log written on every status/assessment/assignment change and every comment.
- `comments` can live in deficiency_events with event_type 'comment'.

Assessment labels in the UI: "Acceptable" (deficient but acceptable in BMD's opinion, colour muted green), "Needs client review" (amber), "Must fix" (red).

## Status workflow (enforce in UI and in a DB trigger)
- New item: status = open. If assessment = client_review → status = awaiting_client. If assessment = acceptable → status = verified (closed) with a note, since nothing to fix, but it stays visible in reports.
- Client (or admin on the client's behalf) resolves awaiting_client → accepted_as_is (closes) or fix_required.
- open / fix_required → in_progress → fixed (requires at least one 'after' photo) → verified (BMD admin or client). Only bmd_admin/client can verify.
- Allow admin to change assessment later; log it.

## Pages / views
1. **Capture** (default on mobile): step flow — pick floor → pick location (rooms as a tappable grid of numbers, with common areas listed below; "add room" inline) → area → material → issue type → assessment (three big buttons) → photos (camera capture via file input with capture="environment", multiple) → optional note → Save. After save show "Add another in this room" / "Next room" / "Done". Remember last floor/room.
2. **Floor grid**: per floor, a grid of room tiles colour-coded: grey = no items, red = has must-fix open, amber = awaiting client, green = all closed. Tap a tile → items for that location. Corridor/common areas shown as a row above the rooms.
3. **Board (Kanban)**: columns Open · Awaiting client · Fix required · In progress · Fixed · Closed (accepted_as_is + verified). Cards show D-number, room, material/issue, thumbnail, assessment badge. Drag between columns on desktop; on mobile use a status button on the card.
4. **Dashboard**: stat tiles (Total, Acceptable, Needs client review, Must fix, Open, Closed), bar chart of open items by floor, bar chart by material, breakdown by issue type, and a burn-down line (open items over time from deficiency_events). Filters: floor, assessment, material, date range.
5. **List**: sortable/filterable table with search, bulk select → change status / assign / change assessment.
6. **Item detail**: photos gallery (before/after), all fields editable per role, status action buttons appropriate to role, activity timeline, comments.
7. **Client portal** (role client): landing page = "Needs your decision" queue with photos and Accept-as-is / Fix-required buttons plus a note; then read-only access to dashboard, floor grid, list and item detail. Clients cannot edit BMD fields or delete.
8. **Exports** page: (a) PDF report — project header, summary counts, then floor-by-floor, location-by-location listing with D-number, area, material, issue, assessment, status, description and photo thumbnails, with filters (floor, assessment, status, open only); generate client-side. (b) Excel (.xlsx) and CSV export of all items with the same filters, one row per item including photo URLs.
9. **Settings** (bmd_admin): manage floors and locations (bulk paste room numbers, e.g. "1201-1240"), edit pick lists, manage users/roles and invite users, project details.

## Design
Clean, professional, high-contrast field UI. Neutral palette with a dark navy primary; the three assessment colours as above. Large 48px+ touch targets on capture. Show the BMD Materials name in the header. Responsive: bottom tab bar on mobile (Capture, Floors, Board, More), sidebar on desktop.

## Seed data
Seed Hyatt Centric with floors 2–8, rooms numbered floor+01..floor+24 (e.g. 201–224), plus per floor common areas "Corridor – North", "Corridor – South", "Elevator lobby". Add ~12 sample deficiencies across categories and statuses (with no photos) so the dashboard and board are populated; make them easy to delete via a "Clear sample data" button in Settings.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://bmd-punch-list.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4ee30e5b-d222-45f5-8a77-2a181efc21f2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
