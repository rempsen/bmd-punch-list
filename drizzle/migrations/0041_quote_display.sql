-- What each quote shows the client (grouping and which figures are visible), and which marked-up drawings go with it.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS display jsonb;
--> statement-breakpoint
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS drawing_sheet_ids uuid[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
GRANT UPDATE (display, drawing_sheet_ids) ON public.quotes TO authenticated;
