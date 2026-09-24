create policy "photos readable by authenticated" on storage.objects for select to authenticated
  using (bucket_id = 'deficiency-photos');
create policy "photos uploadable by bmd" on storage.objects for insert to authenticated
  with check (bucket_id = 'deficiency-photos'
    and (public.has_role(auth.uid(),'bmd_admin') or public.has_role(auth.uid(),'bmd_field')));
create policy "photos deletable by admin" on storage.objects for delete to authenticated
  using (bucket_id = 'deficiency-photos' and public.has_role(auth.uid(),'bmd_admin'));