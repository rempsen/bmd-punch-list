-- Measurements brought forward from an earlier drawing revision stay flagged until someone confirms them on the new sheet.
ALTER TABLE public.takeoff_shapes ADD COLUMN IF NOT EXISTS needs_checking boolean NOT NULL DEFAULT false;
