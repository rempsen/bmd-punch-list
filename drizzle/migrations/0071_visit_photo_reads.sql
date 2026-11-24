-- Visit photos (PR #27) are listed to anyone who can read the visit (project document access or view_pipeline), but the
-- photo bucket's read rule only let job members through, so pipeline viewers saw blank thumbnails. The bucket rule now
-- matches the table rule for files that belong to a visit photo; deficiency photos keep the job-member rule.
DROP POLICY IF EXISTS "photos readable by job members" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "photos readable by job members" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'deficiency-photos'
    AND (
      public.is_project_member(public.photo_path_project(name))
      OR EXISTS (
        SELECT 1 FROM public.install_visit_photos p
        WHERE p.storage_path = name
          AND (public.can_project_documents(p.project_id, false) OR public.has_capability('view_pipeline'))
      )
    )
  );
