ALTER TABLE public.estimate_lines ADD COLUMN IF NOT EXISTS import_row_id uuid REFERENCES public.estimate_import_rows(id) ON DELETE SET NULL;
ALTER TABLE public.estimate_import_rows ADD COLUMN IF NOT EXISTS commit_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.import_line_snapshot(_line uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('line',to_jsonb(l),'parts',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.estimate_line_components c WHERE c.line_id=l.id),'[]'::jsonb)) FROM public.estimate_lines l WHERE l.id=_line;
$$;
REVOKE ALL ON FUNCTION public.import_line_snapshot(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.commit_estimate_import(_import uuid, _items jsonb, _append boolean DEFAULT false, _ack boolean DEFAULT false, _sell numeric DEFAULT 0) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE imp public.estimate_imports; vid uuid; p jsonb; lid uuid; rid uuid; n int:=0; file_sell numeric; s public.project_stage;
BEGIN
 SELECT * INTO imp FROM public.estimate_imports WHERE id=_import FOR UPDATE;
 IF imp.id IS NULL OR NOT public.has_capability('manage_projects',imp.project_id) OR NOT public.has_capability('view_pricing',imp.project_id) THEN RAISE EXCEPTION 'Not allowed to import this estimate'; END IF;
 IF imp.status NOT IN ('parsed','reviewing') THEN RAISE EXCEPTION 'Import already committed or discarded'; END IF;
 IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'Include at least one line'; END IF;
 -- The file's own total, plus the materials tax it charged separately when that tax is folded into material costs.
 file_sell:=nullif(imp.summary->'file_totals'->>'sell','')::numeric
   + CASE WHEN nullif(imp.options->>'gross_up_pst_pct','') IS NOT NULL THEN coalesce(nullif(imp.summary->'totals'->>'materials_tax','')::numeric,0) ELSE 0 END;
 IF file_sell IS NOT NULL AND abs(_sell-file_sell)>1 AND NOT _ack THEN RAISE EXCEPTION 'Acknowledge the difference from the file total'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('estimate_import_commit'||imp.project_id::text));
 IF _append THEN SELECT id INTO vid FROM public.estimate_versions WHERE project_id=imp.project_id AND is_base AND kind='estimate' FOR UPDATE; END IF;
 IF vid IS NULL THEN vid:=public.create_estimate_version(imp.project_id, CASE WHEN EXISTS(SELECT 1 FROM public.estimate_versions WHERE project_id=imp.project_id AND kind='estimate') THEN 'Imported from '||coalesce(imp.file_name,'file') ELSE '' END); END IF;
 IF EXISTS(SELECT 1 FROM public.estimate_versions WHERE id=vid AND locked AND unlocked_at IS NULL) THEN RAISE EXCEPTION 'Cannot append to a locked estimate'; END IF;
 FOR p IN SELECT * FROM jsonb_array_elements(_items) LOOP
  rid:=(p->>'import_row_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.estimate_import_rows WHERE id=rid AND import_id=imp.id AND kind='item') THEN RAISE EXCEPTION 'Invalid import row'; END IF;
  IF EXISTS(SELECT 1 FROM public.estimate_import_rows WHERE id=rid AND estimate_line_id IS NOT NULL) THEN RAISE EXCEPTION 'Duplicate import row'; END IF;
  lid:=(public.save_estimate_line((p-'import_row_id'-'decision')||jsonb_build_object('version_id',vid))->>'id')::uuid;
  UPDATE public.estimate_lines SET import_row_id=rid,source='import' WHERE id=lid;
  UPDATE public.estimate_import_rows SET estimate_line_id=lid,decision='imported',decision_meta=p->'decision',commit_snapshot=public.import_line_snapshot(lid) WHERE id=rid;
  n:=n+1;
 END LOOP;
 UPDATE public.estimate_import_rows SET decision='left_out' WHERE import_id=imp.id AND kind='item' AND estimate_line_id IS NULL;
 UPDATE public.estimate_imports SET status='committed',estimate_version_id=vid,version_id=vid,committed_at=now(),updated_at=now(),
   reconciliation=jsonb_build_object('appended',_append,'sell',_sell,'file_target',file_sell,'acknowledged',_ack) WHERE id=imp.id;
 SELECT stage INTO s FROM public.projects WHERE id=imp.project_id;
 INSERT INTO public.project_stage_events(project_id,from_stage,to_stage,changed_by,note) VALUES(imp.project_id,s,s,auth.uid(),'Imported '||n||' lines from '||coalesce(imp.file_name,'file'));
 RETURN vid;
END $$;
REVOKE ALL ON FUNCTION public.commit_estimate_import(uuid,jsonb,boolean,boolean,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.commit_estimate_import(uuid,jsonb,boolean,boolean,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.undo_estimate_import(_import uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE imp public.estimate_imports; r record; s public.project_stage;
BEGIN
 SELECT * INTO imp FROM public.estimate_imports WHERE id=_import FOR UPDATE;
 IF imp.id IS NULL OR NOT public.has_capability('manage_projects',imp.project_id) OR NOT public.has_capability('view_pricing',imp.project_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF imp.status<>'committed' THEN RAISE EXCEPTION 'Import is not committed'; END IF;
 PERFORM 1 FROM public.estimate_versions WHERE id=imp.estimate_version_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.estimate_versions WHERE id=imp.estimate_version_id AND locked AND unlocked_at IS NULL) THEN RAISE EXCEPTION 'Cannot undo a locked estimate'; END IF;
 PERFORM 1 FROM public.estimate_lines WHERE import_row_id IN (SELECT id FROM public.estimate_import_rows WHERE import_id=imp.id) FOR UPDATE;
 FOR r IN SELECT * FROM public.estimate_import_rows WHERE import_id=imp.id AND commit_snapshot IS NOT NULL LOOP
  IF r.estimate_line_id IS NULL OR r.commit_snapshot IS DISTINCT FROM public.import_line_snapshot(r.estimate_line_id) THEN RAISE EXCEPTION 'Imported lines have been edited; undo is unavailable'; END IF;
 END LOOP;
 DELETE FROM public.estimate_lines WHERE import_row_id IN (SELECT id FROM public.estimate_import_rows WHERE import_id=imp.id);
 UPDATE public.estimate_import_rows SET estimate_line_id=NULL, commit_snapshot=NULL WHERE import_id=imp.id;
 -- A version the import made, now empty, goes too; one it added to stays.
 IF NOT coalesce((imp.reconciliation->>'appended')::boolean,false) AND NOT EXISTS(SELECT 1 FROM public.estimate_lines WHERE version_id=imp.estimate_version_id) THEN
  BEGIN
   DELETE FROM public.estimate_versions WHERE id=imp.estimate_version_id;
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
 END IF;
 UPDATE public.estimate_imports SET status='discarded',updated_at=now() WHERE id=imp.id;
 SELECT stage INTO s FROM public.projects WHERE id=imp.project_id;
 INSERT INTO public.project_stage_events(project_id,from_stage,to_stage,changed_by,note) VALUES(imp.project_id,s,s,auth.uid(),'Undo import from '||coalesce(imp.file_name,'file'));
END $$;
REVOKE ALL ON FUNCTION public.undo_estimate_import(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.undo_estimate_import(uuid) TO authenticated;
