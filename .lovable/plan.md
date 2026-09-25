# Email-to-deficiency intake (dan+ingest@bmdmaterials.com)

## What the user gets
- Forward or send any issue email to **dan+ingest@bmdmaterials.com** (Microsoft 365 already delivers "+" addresses to Dan's inbox; no GoDaddy/DNS changes).
- Every few minutes the app reads new mail sent to that address, and AI turns each email into a deficiency that goes **straight into Open**. Photos attached to the email become "before" photos.
- Nothing is dropped. If the AI can't work out the job, floor, room, material or issue, the item is still created as Open and marked **Needs review**, with the unknown fields clearly highlighted.
- A new **Email intake** page (Settings area and Dashboard badge) lists every ingested email: the original email beside the item it created, with each field editable inline (job, floor, room, area, material, issue, assessment, description). Fields the AI was unsure of are shown in amber.
- No automatic reply is sent.

## Jobs the AI can't match
- A deficiency must belong to a job, so there is a setting **"Job for unmatched emails"** (defaults to Hyatt Centric 325 Broadway).
- Unmatched emails go into that job as Open, flagged Needs review, in a placeholder location **"From email – location to confirm"**. One click on the intake page moves the item to the right job and room.

## Training loop
- **Rules box** (plain-English instructions you and I refine, e.g. "Hyatt emails from Azim are always Hyatt Centric", "'lippage' = Wall tile / Lippage").
- **Learned examples:** every time someone corrects an AI guess, the original email and the corrected fields are saved as an example. The most relevant recent examples are shown to the AI on each new email, so accuracy improves with use.
- The intake page shows an accuracy line ("last 30 emails: 82% of fields right first time"). Examples can be switched off if one teaches the wrong thing.
- **Re-read with AI** button re-runs a single email after rules change.

## Setup step for you
- Connect Dan's Microsoft 365 mailbox once through the Microsoft Outlook connection (a sign-in card in chat). Read access to mail only is needed.

## Technical details
- Connector: `microsoft_outlook` via gateway; poll `GET /me/messages?$filter=receivedDateTime gt {cursor}` and match recipients containing `+ingest@`; fetch attachments (images only, compressed server-side is not possible on Worker → store original, size-capped).
- Schedule: pg_cron hitting `/api/public/intake/poll` (secret-token header) every 5 min; also a "Check now" button.
- New tables (with GRANTs + RLS, manage_settings to read/write): `email_intake` (message_id unique, from, subject, body_text, received_at, project_id, deficiency_id, ai_json, confidence jsonb, status parsed|needs_review|reviewed|error, error), `intake_examples` (email_intake_id, corrected jsonb, active), `intake_settings` (default_project_id, rules text, cursor). New column `deficiencies.needs_review boolean default false` with its column-level `GRANT SELECT` in the same migration; `source text` ('email').
- Parsing: Lovable AI `openai/gpt-6-astra` on Responses API, structured output (job, floor, room, area, material, issue, assessment, description, per-field confidence) with the job list, floors/rooms and pick lists passed as context; matching done in code against real IDs.
- Insert uses the service role inside the poll route only, with created_by = Dan, responsible_party `unassigned`, status `open`; events logged "Created from email".
- Corrections on the intake page write through the normal update path (RLS/trigger rules apply) and save an example.
