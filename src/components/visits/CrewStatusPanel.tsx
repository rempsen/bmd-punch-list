import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { acceptanceBadge, crewLabel, crewStatusGroups, updatedAt, visitRange, type Visit } from "@/lib/visits/logic";
import { useProjectVisits } from "@/lib/visits/data";
import { AcceptancePill, OpenInArrivePing, StatusPill } from "./visit-bits";
import { useArrivePingCheck } from "@/components/visits/useArrivePingCheck";

function VisitRow({ v }: { v: Visit }) {
  const range = visitRange(v.starts_at, v.ends_at);
  const people = [v.crew, v.arriveping_assigned_to].filter(Boolean).join(" · ");
  return (
    <li className={`space-y-1 py-3 text-sm ${v.status === "cancelled" ? "opacity-60" : ""}`}>
      <p className="font-medium">{range}</p>
      {people && <p className="truncate text-xs text-muted-foreground">{people}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <StatusPill label={crewLabel(v)} jobId={v.arriveping_job_id} />
        <AcceptancePill badge={acceptanceBadge(v)} jobId={v.arriveping_job_id} />
        {v.arriveping_last_event_at && (
          <span className="text-xs text-muted-foreground">
            Updated {updatedAt(v.arriveping_last_event_at)}
          </span>
        )}
        {v.arriveping_job_id && <OpenInArrivePing jobId={v.arriveping_job_id} />}
      </div>
    </li>
  );
}

/** Who is on site and what is coming, read from the install visits ArrivePing keeps current. Read only: changes are made on the Overview tab. */
export function CrewStatusPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data: visits = [], isLoading, isError } = useProjectVisits(projectId);
  useArrivePingCheck(projectId, visits.some((v) => v.arriveping_job_id));
  const [showPast, setShowPast] = useState(false);
  const headingId = useId();
  const pastId = useId();
  const { active, upcoming, past } = crewStatusGroups(visits);
  const current = [...active, ...upcoming];
  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="font-semibold">
        Crew status
      </h2>
      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          Couldn't load install visits. Try reloading the page.
        </p>
      ) : visits.length === 0 ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">No install visits scheduled.</p>
          {canEdit && (
            <p className="text-xs text-muted-foreground">Schedule one from the Overview tab.</p>
          )}
        </>
      ) : (
        <>
          {current.length > 0 ? (
            <ul className="mt-3 divide-y divide-border">
              {current.map((v) => (
                <VisitRow key={v.id} v={v} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No visits under way or coming up.</p>
          )}
          {past.length > 0 && (
            <div className="mt-2">
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showPast}
                aria-controls={pastId}
                onClick={() => setShowPast((s) => !s)}
              >
                {showPast ? "Hide past visits" : `Show past visits (${past.length})`}
              </Button>
              <ul id={pastId} hidden={!showPast} className="divide-y divide-border">
                {past.map((v) => (
                  <VisitRow key={v.id} v={v} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
