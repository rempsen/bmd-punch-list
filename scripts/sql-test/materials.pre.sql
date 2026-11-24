-- State before 0063: a job (Test Take Off) whose material was already seeded by 0055 when it entered Won.
-- Those rows have no source_version_id; the 0063 backfill must not seed that version again.
INSERT INTO estimate_versions (id, project_id, is_base) VALUES ('70000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', true);
INSERT INTO estimate_lines (id, version_id, description, driver_qty, driver_uom) VALUES ('80000000-0000-0000-0000-000000000009', '70000000-0000-0000-0000-000000000009', 'Lobby tile', 100, 'SF');
INSERT INTO estimate_line_components (line_id, kind, label, unit_cost_cents, cost_uom, purchase_uom, coverage_per_purchase_unit, round_up)
  VALUES ('80000000-0000-0000-0000-000000000009', 'material', 'Tile', 3000, 'BOX', 'BOX', 10, true);
INSERT INTO quotes (project_id, kind, status, accepted_at, accepted_version_id) VALUES ('10000000-0000-0000-0000-000000000002', 'quote', 'accepted', now(), '70000000-0000-0000-0000-000000000009');
UPDATE projects SET stage = 'won' WHERE id = '10000000-0000-0000-0000-000000000002';
DO $$ BEGIN ASSERT (SELECT count(*) FROM material_orders WHERE project_id = '10000000-0000-0000-0000-000000000002') = 1, 'pre: seeded once by 0055'; END $$;
