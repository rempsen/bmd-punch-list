-- Materials after acceptance: what lands in Ordering, and when.
-- The 0063 backfill left the job seeded under 0055 alone (see materials.pre.sql).
DO $$ BEGIN ASSERT (SELECT count(*) FROM material_orders WHERE project_id = '10000000-0000-0000-0000-000000000002') = 1, 'backfill did not re-seed a version 0055 already seeded'; END $$;
\set p1 '''10000000-0000-0000-0000-000000000001'''
-- A job already in progress (as Test Take Off was) with one estimate version: an LVT line (material + labour) and an optional line.
UPDATE projects SET stage = 'in_progress' WHERE id = :p1;
INSERT INTO suppliers (id, name) VALUES ('50000000-0000-0000-0000-000000000001', 'Prosol');
INSERT INTO catalogue_materials (id, name, supplier_id) VALUES ('60000000-0000-0000-0000-000000000001', 'LVT Oak', '50000000-0000-0000-0000-000000000001');
INSERT INTO estimate_versions (id, project_id, is_base) VALUES ('70000000-0000-0000-0000-000000000001', :p1, true), ('70000000-0000-0000-0000-000000000002', :p1, false);
INSERT INTO estimate_lines (id, version_id, description, driver_qty, driver_uom, selection) VALUES
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'Corridor LVT', 1000, 'SF', 'required'),
  ('80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'Optional upgrade', 100, 'SF', 'optional'),
  ('80000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 'Extra room', 200, 'SF', 'required');
INSERT INTO estimate_line_components (line_id, kind, label, catalogue_material_id, unit_cost_cents, cost_uom, purchase_uom, coverage_per_purchase_unit, waste_pct, round_up) VALUES
  ('80000000-0000-0000-0000-000000000001', 'material', 'LVT Oak', '60000000-0000-0000-0000-000000000001', 5000, 'BOX', 'BOX', 20, 10, true),
  ('80000000-0000-0000-0000-000000000001', 'labour', 'Install', NULL, 200, 'SF', 'SF', NULL, 0, false),
  ('80000000-0000-0000-0000-000000000002', 'material', 'Upgrade', '60000000-0000-0000-0000-000000000001', 5000, 'BOX', 'BOX', 20, 0, true),
  ('80000000-0000-0000-0000-000000000003', 'material', 'LVT Oak', '60000000-0000-0000-0000-000000000001', 5000, 'BOX', 'BOX', 20, 0, true);
INSERT INTO quotes (id, project_id, kind, status) VALUES ('90000000-0000-0000-0000-000000000001', :p1, 'quote', 'sent');

-- Accepting the quote, with the job already in progress, puts its material in Ordering.
UPDATE quotes SET status = 'accepted', accepted_at = now(), accepted_version_id = '70000000-0000-0000-0000-000000000001' WHERE id = '90000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM material_orders WHERE project_id = '10000000-0000-0000-0000-000000000001') = 1, 'one material line seeded (labour and optional lines are not)';
  ASSERT (SELECT status FROM material_orders WHERE project_id = '10000000-0000-0000-0000-000000000001' LIMIT 1) = 'to_order', 'lands in To order';
  ASSERT (SELECT ordered_at FROM material_orders WHERE project_id = '10000000-0000-0000-0000-000000000001' LIMIT 1) IS NULL, 'not marked ordered yet';
  ASSERT (SELECT quantity FROM material_orders WHERE project_id = '10000000-0000-0000-0000-000000000001' LIMIT 1) = 55, '1000 SF + 10% waste at 20 SF a box = 55 boxes';
  ASSERT (SELECT supplier_id FROM material_orders WHERE project_id = '10000000-0000-0000-0000-000000000001' LIMIT 1) = '50000000-0000-0000-0000-000000000001', 'supplier from the catalogue';
  ASSERT (SELECT source_version_id FROM material_orders WHERE project_id = '10000000-0000-0000-0000-000000000001' LIMIT 1) = '70000000-0000-0000-0000-000000000001', 'remembers which version it came from';
END $$;

-- Re-accepting, or the job then moving to Won, does not seed the same version twice.
UPDATE quotes SET status = 'sent' WHERE id = '90000000-0000-0000-0000-000000000001';
UPDATE quotes SET status = 'accepted' WHERE id = '90000000-0000-0000-0000-000000000001';
UPDATE projects SET stage = 'won' WHERE id = :p1;
DO $$ BEGIN ASSERT (SELECT count(*) FROM material_orders WHERE project_id = '10000000-0000-0000-0000-000000000001') = 1, 'no duplicates'; END $$;

-- An accepted change order adds its own version's material, whatever the stage.
INSERT INTO quotes (id, project_id, kind, status) VALUES ('90000000-0000-0000-0000-000000000002', :p1, 'change_order', 'sent');
UPDATE quotes SET status = 'accepted', accepted_version_id = '70000000-0000-0000-0000-000000000002' WHERE id = '90000000-0000-0000-0000-000000000002';
DO $$ BEGIN ASSERT (SELECT count(*) FROM material_orders WHERE source_version_id = '70000000-0000-0000-0000-000000000002') = 1, 'change order seeded'; END $$;

-- Lines added by hand start in To order too.
INSERT INTO material_orders (project_id, description, quantity, unit) VALUES (:p1, 'Transition strips', 4, 'EA');
DO $$ BEGIN ASSERT (SELECT status FROM material_orders WHERE description = 'Transition strips') = 'to_order', 'manual lines start in To order'; END $$;

SELECT 'materials SQL tests passed' AS result;
