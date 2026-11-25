-- Being assigned a work order in ArrivePing is not accepting it (Dan, 24 Nov 2026). Until now BMD recorded an assignment as
-- the crew's acceptance. Clear every acceptance that came only from an assignment: one with no "accepted" entry in the
-- visit's activity. A real acceptance from ArrivePing logs that entry and is kept. Safe to run more than once.
update install_visits v
   set accepted_at = null, accepted_by = null
 where v.accepted_at is not null
   and not exists (select 1 from install_visit_events e where e.visit_id = v.id and e.status = 'accepted');
