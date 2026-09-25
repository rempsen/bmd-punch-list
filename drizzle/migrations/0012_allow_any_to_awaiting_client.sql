CREATE OR REPLACE FUNCTION public.def_before_update()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  allowed public.deficiency_status[];
  uid uuid := auth.uid();
  can_any boolean; can_own boolean; decided boolean;
BEGIN
  new.updated_at := now();

  IF uid IS NOT NULL THEN
    can_any := public.has_capability('edit_any_item', old.project_id);
    can_own := public.has_capability('edit_own_item', old.project_id) AND old.created_by = uid;

    IF (new.area, new.material, new.issue_type, coalesce(new.description,''), new.location_id,
        coalesce(new.due_date::text,''), new.is_sample, new.project_id, new.item_number, coalesce(new.created_by::text,''))
       IS DISTINCT FROM
       (old.area, old.material, old.issue_type, coalesce(old.description,''), old.location_id,
        coalesce(old.due_date::text,''), old.is_sample, old.project_id, old.item_number, coalesce(old.created_by::text,''))
       AND NOT (can_any OR can_own) THEN
      RAISE EXCEPTION 'You do not have permission to edit this item';
    END IF;

    IF new.project_id <> old.project_id THEN
      RAISE EXCEPTION 'Items cannot be moved to another job';
    END IF;

    IF coalesce(new.assigned_to::text,'') <> coalesce(old.assigned_to::text,'')
       AND NOT public.has_capability('assign_items', old.project_id) THEN
      RAISE EXCEPTION 'You do not have permission to assign items';
    END IF;

    IF new.assessment <> old.assessment THEN
      IF NOT public.has_capability('change_assessment', old.project_id) OR NOT (can_any OR can_own) THEN
        RAISE EXCEPTION 'You do not have permission to change the assessment';
      END IF;
      IF NOT can_any THEN
        decided := old.status IN ('accepted_as_is','fix_required') OR EXISTS (
          SELECT 1 FROM public.deficiency_events e
          WHERE e.deficiency_id = old.id AND e.event_type = 'status_change' AND e.from_value = 'awaiting_client');
        IF decided THEN
          RAISE EXCEPTION 'The assessment cannot be changed after a client decision';
        END IF;
      END IF;
    END IF;

    IF coalesce(new.client_decision_note,'') <> coalesce(old.client_decision_note,'')
       AND NOT (public.has_capability('decide_client_items', old.project_id) OR can_any) THEN
      RAISE EXCEPTION 'You do not have permission to record client decisions';
    END IF;
  END IF;

  IF new.status <> old.status THEN
    -- Any item can be sent to the client for feedback, from any status.
    allowed := CASE old.status
      WHEN 'open' THEN ARRAY['awaiting_client','fix_required','in_progress','verified','accepted_as_is']::public.deficiency_status[]
      WHEN 'awaiting_client' THEN ARRAY['accepted_as_is','fix_required','open']::public.deficiency_status[]
      WHEN 'fix_required' THEN ARRAY['in_progress','fixed','open','awaiting_client']::public.deficiency_status[]
      WHEN 'in_progress' THEN ARRAY['fixed','fix_required','awaiting_client']::public.deficiency_status[]
      WHEN 'fixed' THEN ARRAY['verified','fix_required','awaiting_client']::public.deficiency_status[]
      WHEN 'verified' THEN ARRAY['fix_required','open','awaiting_client']::public.deficiency_status[]
      WHEN 'accepted_as_is' THEN ARRAY['fix_required','open','awaiting_client']::public.deficiency_status[]
    END;
    IF NOT (new.status = ANY(allowed)) THEN
      RAISE EXCEPTION 'Invalid status change: % -> %', old.status, new.status;
    END IF;
    IF new.status = 'fixed' AND NOT EXISTS (
      SELECT 1 FROM public.deficiency_photos p WHERE p.deficiency_id = new.id AND p.kind = 'after'
    ) THEN
      RAISE EXCEPTION 'An "after" photo is required before marking an item fixed';
    END IF;

    IF uid IS NOT NULL THEN
      IF new.status = 'verified' AND NOT public.has_capability('verify_items', old.project_id) THEN
        RAISE EXCEPTION 'You do not have permission to verify items';
      ELSIF old.status = 'awaiting_client' AND new.status IN ('accepted_as_is','fix_required')
            AND NOT public.has_capability('decide_client_items', old.project_id) THEN
        RAISE EXCEPTION 'Only the client (or a manager on their behalf) can decide this item';
      ELSIF new.status IN ('in_progress','fixed')
            AND NOT (public.has_capability('add_photos', old.project_id) OR can_any OR can_own) THEN
        RAISE EXCEPTION 'You do not have permission to update work progress';
      ELSIF new.status = 'accepted_as_is' AND old.status <> 'awaiting_client'
            AND NOT (can_any OR public.has_capability('decide_client_items', old.project_id)) THEN
        RAISE EXCEPTION 'You do not have permission to accept items';
      ELSIF new.status = 'fix_required' AND old.status IN ('fixed','verified','accepted_as_is','in_progress')
            AND NOT (can_any OR public.has_capability('verify_items', old.project_id) OR public.has_capability('decide_client_items', old.project_id)) THEN
        RAISE EXCEPTION 'You do not have permission to reopen items';
      ELSIF new.status = 'awaiting_client'
            AND NOT (can_any OR can_own OR public.has_capability('change_assessment', old.project_id) OR public.has_capability('capture_items', old.project_id)) THEN
        RAISE EXCEPTION 'You do not have permission to send items to the client';
      ELSIF new.status = 'open' AND NOT (can_any OR can_own) THEN
        RAISE EXCEPTION 'You do not have permission to reopen items';
      END IF;
    END IF;

    IF new.status IN ('verified','accepted_as_is') THEN
      new.closed_at := coalesce(new.closed_at, now());
    ELSE
      new.closed_at := NULL;
    END IF;
  END IF;
  RETURN new;
END; $function$;