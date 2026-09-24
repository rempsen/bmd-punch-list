-- ============ enums ============
create type public.app_role as enum ('bmd_admin','bmd_field','client');
create type public.location_type as enum ('room','common_area');
create type public.pick_kind as enum ('area','material','issue_type');
create type public.assessment_level as enum ('acceptable','client_review','must_fix');
create type public.deficiency_status as enum ('open','awaiting_client','accepted_as_is','fix_required','in_progress','fixed','verified');
create type public.photo_kind as enum ('before','after');

-- ============ profiles ============
create table public.profiles (
  id uuid primary key,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles readable by authenticated" on public.profiles for select to authenticated using (true);
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

-- ============ roles ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select, insert, update, delete on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create policy "roles readable by authenticated" on public.user_roles for select to authenticated using (true);
create policy "admins manage roles" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(),'bmd_admin')) with check (public.has_role(auth.uid(),'bmd_admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare _role public.app_role;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;

  if not exists (select 1 from public.user_roles) then
    _role := 'bmd_admin';
  else
    _role := coalesce(nullif(new.raw_user_meta_data->>'requested_role',''), 'bmd_field')::public.app_role;
  end if;

  insert into public.user_roles (user_id, role) values (new.id, _role) on conflict do nothing;
  return new;
end; $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ projects / floors / locations ============
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  address text,
  created_at timestamptz not null default now()
);
create table public.floors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  number int not null,
  label text not null,
  sort_order int not null default 0
);
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete cascade,
  type public.location_type not null default 'room',
  name text not null,
  room_type text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table public.pick_lists (
  id uuid primary key default gen_random_uuid(),
  kind public.pick_kind not null,
  value text not null,
  sort_order int not null default 0,
  active boolean not null default true
);

grant select, insert, update, delete on public.projects, public.floors, public.locations, public.pick_lists to authenticated;
grant all on public.projects, public.floors, public.locations, public.pick_lists to service_role;
alter table public.projects enable row level security;
alter table public.floors enable row level security;
alter table public.locations enable row level security;
alter table public.pick_lists enable row level security;

create policy "projects read" on public.projects for select to authenticated using (true);
create policy "projects admin write" on public.projects for all to authenticated
  using (public.has_role(auth.uid(),'bmd_admin')) with check (public.has_role(auth.uid(),'bmd_admin'));
create policy "floors read" on public.floors for select to authenticated using (true);
create policy "floors admin write" on public.floors for all to authenticated
  using (public.has_role(auth.uid(),'bmd_admin')) with check (public.has_role(auth.uid(),'bmd_admin'));
create policy "locations read" on public.locations for select to authenticated using (true);
create policy "locations bmd write" on public.locations for all to authenticated
  using (public.has_role(auth.uid(),'bmd_admin') or public.has_role(auth.uid(),'bmd_field'))
  with check (public.has_role(auth.uid(),'bmd_admin') or public.has_role(auth.uid(),'bmd_field'));
create policy "picklists read" on public.pick_lists for select to authenticated using (true);
create policy "picklists admin write" on public.pick_lists for all to authenticated
  using (public.has_role(auth.uid(),'bmd_admin')) with check (public.has_role(auth.uid(),'bmd_admin'));

-- ============ deficiencies ============
create table public.deficiencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_number int not null default 0,
  location_id uuid not null references public.locations(id) on delete cascade,
  area text not null,
  material text not null,
  issue_type text not null,
  description text,
  assessment public.assessment_level not null default 'must_fix',
  status public.deficiency_status not null default 'open',
  assigned_to uuid,
  due_date date,
  client_decision_note text,
  is_sample boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (project_id, item_number)
);
create table public.deficiency_photos (
  id uuid primary key default gen_random_uuid(),
  deficiency_id uuid not null references public.deficiencies(id) on delete cascade,
  storage_path text not null,
  kind public.photo_kind not null default 'before',
  caption text,
  taken_at timestamptz not null default now(),
  uploaded_by uuid
);
create table public.deficiency_events (
  id uuid primary key default gen_random_uuid(),
  deficiency_id uuid not null references public.deficiencies(id) on delete cascade,
  user_id uuid,
  event_type text not null,
  from_value text,
  to_value text,
  note text,
  created_at timestamptz not null default now()
);
create index on public.deficiencies (project_id, status);
create index on public.deficiency_events (deficiency_id, created_at);

grant select, insert, update, delete on public.deficiencies, public.deficiency_photos, public.deficiency_events to authenticated;
grant all on public.deficiencies, public.deficiency_photos, public.deficiency_events to service_role;
alter table public.deficiencies enable row level security;
alter table public.deficiency_photos enable row level security;
alter table public.deficiency_events enable row level security;

create policy "def read" on public.deficiencies for select to authenticated using (true);
create policy "def bmd insert" on public.deficiencies for insert to authenticated
  with check (public.has_role(auth.uid(),'bmd_admin') or public.has_role(auth.uid(),'bmd_field'));
create policy "def update" on public.deficiencies for update to authenticated
  using (public.has_role(auth.uid(),'bmd_admin') or public.has_role(auth.uid(),'bmd_field') or public.has_role(auth.uid(),'client'));
create policy "def admin delete" on public.deficiencies for delete to authenticated
  using (public.has_role(auth.uid(),'bmd_admin'));

create policy "photos read" on public.deficiency_photos for select to authenticated using (true);
create policy "photos bmd write" on public.deficiency_photos for all to authenticated
  using (public.has_role(auth.uid(),'bmd_admin') or public.has_role(auth.uid(),'bmd_field'))
  with check (public.has_role(auth.uid(),'bmd_admin') or public.has_role(auth.uid(),'bmd_field'));

create policy "events read" on public.deficiency_events for select to authenticated using (true);
create policy "events insert" on public.deficiency_events for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

-- ============ workflow triggers ============
create or replace function public.def_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.item_number is null or new.item_number = 0 then
    select coalesce(max(item_number),0)+1 into new.item_number from public.deficiencies where project_id = new.project_id;
  end if;
  if new.status = 'open' then
    if new.assessment = 'client_review' then new.status := 'awaiting_client';
    elsif new.assessment = 'acceptable' then new.status := 'verified';
    end if;
  end if;
  if new.status in ('verified','accepted_as_is') and new.closed_at is null then
    new.closed_at := now();
  end if;
  return new;
end; $$;
create trigger def_before_insert before insert on public.deficiencies
  for each row execute function public.def_before_insert();

create or replace function public.def_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare allowed public.deficiency_status[];
begin
  new.updated_at := now();
  if new.status <> old.status then
    allowed := case old.status
      when 'open' then array['awaiting_client','fix_required','in_progress','verified','accepted_as_is']::public.deficiency_status[]
      when 'awaiting_client' then array['accepted_as_is','fix_required','open']::public.deficiency_status[]
      when 'fix_required' then array['in_progress','fixed','open']::public.deficiency_status[]
      when 'in_progress' then array['fixed','fix_required']::public.deficiency_status[]
      when 'fixed' then array['verified','fix_required']::public.deficiency_status[]
      when 'verified' then array['fix_required','open']::public.deficiency_status[]
      when 'accepted_as_is' then array['fix_required','open']::public.deficiency_status[]
    end;
    if not (new.status = any(allowed)) then
      raise exception 'Invalid status change: % -> %', old.status, new.status;
    end if;
    if new.status = 'fixed' and not exists (
      select 1 from public.deficiency_photos p where p.deficiency_id = new.id and p.kind = 'after'
    ) then
      raise exception 'An "after" photo is required before marking an item fixed';
    end if;
    if new.status = 'verified' and not (public.has_role(auth.uid(),'bmd_admin') or public.has_role(auth.uid(),'client')) then
      raise exception 'Only BMD admins or the client can verify items';
    end if;
    if new.status in ('verified','accepted_as_is') then
      new.closed_at := coalesce(new.closed_at, now());
    else
      new.closed_at := null;
    end if;
  end if;
  return new;
end; $$;
create trigger def_before_update before update on public.deficiencies
  for each row execute function public.def_before_update();

create or replace function public.def_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.deficiency_events (deficiency_id, user_id, event_type, to_value)
    values (new.id, auth.uid(), 'created', new.status::text);
  else
    if new.status <> old.status then
      insert into public.deficiency_events (deficiency_id, user_id, event_type, from_value, to_value, note)
      values (new.id, auth.uid(), 'status_change', old.status::text, new.status::text, new.client_decision_note);
    end if;
    if new.assessment <> old.assessment then
      insert into public.deficiency_events (deficiency_id, user_id, event_type, from_value, to_value)
      values (new.id, auth.uid(), 'assessment_change', old.assessment::text, new.assessment::text);
    end if;
    if coalesce(new.assigned_to::text,'') <> coalesce(old.assigned_to::text,'') then
      insert into public.deficiency_events (deficiency_id, user_id, event_type, from_value, to_value)
      values (new.id, auth.uid(), 'assignment', old.assigned_to::text, new.assigned_to::text);
    end if;
  end if;
  return null;
end; $$;
create trigger def_after_change after insert or update on public.deficiencies
  for each row execute function public.def_after_change();

-- ============ seed: pick lists ============
insert into public.pick_lists (kind, value, sort_order) values
 ('area','Entry / vestibule',1),('area','Main room',2),('area','Closet',3),
 ('area','Bathroom – shower walls',4),('area','Bathroom – vanity wall',5),
 ('area','Bathroom – general wall tile',6),('area','Bathroom – floor',7),
 ('area','Corridor',8),('area','Other',9),
 ('material','Vinyl plank',1),('material','Floor tile',2),('material','Wall tile',3),
 ('material','Carpet',4),('material','Wall base',5),('material','Transition / trim',6),
 ('material','Grout & caulk',7),
 ('issue_type','Lippage',1),('issue_type','Chipped / cracked',2),('issue_type','Hollow tile',3),
 ('issue_type','Grout inconsistent / missing',4),('issue_type','Caulking missing or poor',5),
 ('issue_type','Exposed cut edge',6),('issue_type','Gap / open joint',7),
 ('issue_type','Scratched / gouged',8),('issue_type','Lifting / peaking',9),
 ('issue_type','Stain / discoloration',10),('issue_type','Layout / pattern misaligned',11),
 ('issue_type','Missing piece',12),('issue_type','Visible seam',13),('issue_type','Loose base',14),
 ('issue_type','Other',15);

-- ============ seed: project, floors, locations ============
do $$
declare _proj uuid; _floor uuid; f int; r int;
begin
  insert into public.projects (name, client_name, address)
  values ('Hyatt Centric','Hyatt Centric / GC', null) returning id into _proj;

  for f in 2..8 loop
    insert into public.floors (project_id, number, label, sort_order)
    values (_proj, f, 'Floor ' || f, f) returning id into _floor;
    for r in 1..24 loop
      insert into public.locations (floor_id, type, name, sort_order)
      values (_floor, 'room', (f*100 + r)::text, r);
    end loop;
    insert into public.locations (floor_id, type, name, sort_order) values
      (_floor,'common_area','Corridor – North',1),
      (_floor,'common_area','Corridor – South',2),
      (_floor,'common_area','Elevator lobby',3);
  end loop;
end $$;

-- ============ seed: sample deficiencies ============
do $$
declare _proj uuid; _loc uuid; s record;
begin
  select id into _proj from public.projects where name = 'Hyatt Centric';
  for s in
    select * from (values
      (2,'204','Bathroom – floor','Floor tile','Lippage','Tile edge stands proud near threshold.','must_fix','open'),
      (2,'Corridor – North','Corridor','Carpet','Visible seam','Seam visible at elevator lobby transition.','client_review','awaiting_client'),
      (3,'312','Main room','Vinyl plank','Scratched / gouged','Long scratch near window wall.','must_fix','in_progress'),
      (3,'305','Bathroom – shower walls','Wall tile','Grout inconsistent / missing','Grout missing at inside corner.','must_fix','fix_required'),
      (4,'410','Closet','Wall base','Loose base','Base loose along back wall.','acceptable','verified'),
      (4,'422','Bathroom – vanity wall','Wall tile','Chipped / cracked','Chip at outlet cut.','client_review','accepted_as_is'),
      (5,'508','Main room','Vinyl plank','Gap / open joint','Small gap between planks.','must_fix','open'),
      (5,'Elevator lobby','Corridor','Floor tile','Hollow tile','Two hollow tiles by elevator doors.','must_fix','fix_required'),
      (6,'611','Entry / vestibule','Transition / trim','Exposed cut edge','Transition cut edge exposed.','client_review','awaiting_client'),
      (6,'624','Bathroom – general wall tile','Grout & caulk','Caulking missing or poor','Caulk missing at tub-to-tile joint.','must_fix','open'),
      (7,'703','Main room','Carpet','Stain / discoloration','Small stain near closet.','acceptable','verified'),
      (8,'812','Bathroom – floor','Floor tile','Layout / pattern misaligned','Pattern offset from centre drain.','must_fix','open')
    ) as t(fl, loc, area, material, issue, descr, assess, st)
  loop
    select l.id into _loc from public.locations l
      join public.floors fl on fl.id = l.floor_id
      where fl.project_id = _proj and fl.number = s.fl and l.name = s.loc limit 1;
    if _loc is not null then
      insert into public.deficiencies (project_id, location_id, area, material, issue_type, description, assessment, status, is_sample)
      values (_proj, _loc, s.area, s.material, s.issue, s.descr, s.assess::public.assessment_level, s.st::public.deficiency_status, true);
    end if;
  end loop;
end $$;