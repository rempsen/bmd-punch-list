import { useState } from "react";
import { Button } from "@/components/ui/button";
import { crewLabel, crewStatusGroups, updatedAt, visitRange, type Visit } from "@/lib/visits/logic";
import { OpenInArrivePing, StatusPill, useProjectVisits } from "./visit-bits";

function VisitRow({ v }: { v: Visit }) {
  const range = visitRange(v.starts_at, v.ends_at);
  const people = [v.crew, v.arriveping_assigned_to].filter(Boolean).join(" · ");
  return (
    <li className={`space-y-1 py-3 text-sm ${v.status === "cancelled" ? "opacity-60" : ""}`}>
      <p className="font-medium">{range}</p>
      {people && <p className="truncate text-xs text-muted-foreground">{people}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <StatusPill label={crewLabel(v)} />
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
export function CrewStatusPanel({ projectId }: { projectId: string }) {
  const { data: visits = [], isLoading, isError } = useProjectVisits(projectId);
  const [showPast, setShowPast] = useState(false);
  const { active, upcoming, past } = crewStatusGroups(visits);
  const current = [...active, ...upcoming];
  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      aria-labelledby="crew-status-h"
    >
      <h2 id="crew-status-h" className="font-semibold">
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
          <p className="text-xs text-muted-foreground">Schedule one from the Overview tab.</p>
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
                aria-controls="crew-status-past"
                onClick={() => setShowPast((s) => !s)}
              >
                {showPast ? "Hide past visits" : `Show past visits (${past.length})`}
              </Button>
              {showPast && (
                <ul id="crew-status-past" className="divide-y divide-border">
                  {past.map((v) => (
                    <VisitRow key={v.id} v={v} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
