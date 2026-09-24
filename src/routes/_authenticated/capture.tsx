import { floorLabel, floorShort } from "@/lib/data";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Camera, Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ASSESSMENTS, itemNo, type Assessment } from "@/lib/bmd";
import {
  useFloors,
  useInvalidateDeficiencies,
  useLocations,
  usePickLists,
  useProject,
} from "@/lib/data";
import { uploadDeficiencyPhoto } from "@/lib/photos";
import { cn } from "@/lib/utils";
import { DesktopCaptureForm } from "@/components/DesktopCaptureForm";

export const Route = createFileRoute("/_authenticated/capture")({
  head: () => ({ meta: [{ title: "Add a deficiency — BMD Deficiency Tracker" }] }),
  component: CapturePage,
});

function CapturePage() {
  return (
    <>
      <div className="md:hidden"><MobileCapture /></div>
      <div className="hidden md:block"><DesktopCaptureForm /></div>
    </>
  );
}

type Step = "floor" | "location" | "area" | "material" | "issue" | "assessment" | "details" | "done";

const STEP_ORDER: Step[] = [
  "floor",
  "location",
  "area",
  "material",
  "issue",
  "assessment",
  "details",
];

function BigOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-[56px] rounded-lg border-2 px-4 py-3 text-left text-base font-medium transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:border-primary/50",
      )}
    >
      {label}
    </button>
  );
}

function MobileCapture() {
  const { user, can } = useAuth();
  const isAdmin = can("manage_settings");
  const { data: project } = useProject();
  const { data: floors = [] } = useFloors(project?.id);
  const floorIds = useMemo(() => floors.map((f) => f.id), [floors]);
  const { data: locations = [] } = useLocations(floorIds);
  const { data: picks } = usePickLists();
  const invalidate = useInvalidateDeficiencies();

  const [step, setStep] = useState<Step>("floor");
  const [floorId, setFloorId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [material, setMaterial] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNumber, setSavedNumber] = useState<number | null>(null);
  const [newRoom, setNewRoom] = useState("");

  useEffect(() => {
    const lastFloor = localStorage.getItem("bmd:lastFloor");
    const lastLocation = localStorage.getItem("bmd:lastLocation");
    if (lastFloor && floors.some((f) => f.id === lastFloor)) {
      setFloorId(lastFloor);
      if (lastLocation) setLocationId(lastLocation);
    } else {
      setFloorId(null);
      setLocationId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors.map((f) => f.id).join("|")]);

  const floorLocations = locations.filter((l) => l.floor_id === floorId);
  const rooms = floorLocations.filter((l) => l.type === "room");
  const commons = floorLocations.filter((l) => l.type === "common_area");
  const floor = floors.find((f) => f.id === floorId);
  const location = locations.find((l) => l.id === locationId);

  const back = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1] as Step);
  };

  const addRoom = async () => {
    if (!newRoom.trim() || !floorId) return;
    const { data, error } = await supabase
      .from("locations")
      .insert({ floor_id: floorId, type: "room", name: newRoom.trim(), sort_order: 999 })
      .select("id")
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewRoom("");
    if (data) {
      setLocationId(data.id);
      setStep("area");
    }
  };

  const save = async () => {
    if (!project || !locationId || !area || !material || !issue || !assessment) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("deficiencies")
        .insert({
          project_id: project.id,
          location_id: locationId,
          area,
          material,
          issue_type: issue,
          description: note.trim() || null,
          assessment,
          created_by: user?.id ?? null,
        })
        .select("id,item_number")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Could not save the item");

      for (const file of files) {
        await uploadDeficiencyPhoto(data.id, file, "before", user?.id);
      }
      localStorage.setItem("bmd:lastFloor", floorId ?? "");
      localStorage.setItem("bmd:lastLocation", locationId);
      setSavedNumber(data.item_number);
      setStep("done");
      invalidate();
      toast.success(`${itemNo(data.item_number)} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const resetItem = (keepRoom: boolean) => {
    setArea(null);
    setMaterial(null);
    setIssue(null);
    setAssessment(null);
    setFiles([]);
    setNote("");
    setSavedNumber(null);
    if (!keepRoom) setLocationId(null);
    setStep(keepRoom ? "area" : "location");
  };

  const crumb = [
    floor ? floorLabel(floor) : null,
    location?.name,
    area,
    material,
    issue,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <PageHeader
        title="Add a deficiency"
        subtitle={crumb || project?.name || "New item"}
        actions={
          step !== "floor" && step !== "done" ? (
            <Button variant="ghost" className="h-11" onClick={back}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
          ) : undefined
        }
      />

      <div className="p-4 md:p-6">
        {step === "floor" && (
          <Section title="Which floor?">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {floors.map((f) => (
                <BigOption
                  key={f.id}
                  label={floorShort(f)}
                  selected={f.id === floorId}
                  onClick={() => {
                    setFloorId(f.id);
                    setStep("location");
                  }}
                />
              ))}
            </div>
          </Section>
        )}

        {step === "location" && (
          <Section title="Which room or area?">
            {rooms.length === 0 && (
              <p className="mb-2 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                No guest rooms on this floor — pick a common area below
                {isAdmin ? ", or add a room number." : "."}
              </p>
            )}
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {rooms.map((l) => (
                <BigOption
                  key={l.id}
                  label={l.name}
                  selected={l.id === locationId}
                  onClick={() => {
                    setLocationId(l.id);
                    setStep("area");
                  }}
                />
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Input
                value={newRoom}
                onChange={(e) => setNewRoom(e.target.value)}
                placeholder="Add room number"
                className="h-12"
              />
              <Button onClick={addRoom} className="h-12">
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </div>
            <h3 className="mt-6 mb-2 text-sm font-semibold text-muted-foreground uppercase">
              Common areas
            </h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {commons.map((l) => (
                <BigOption
                  key={l.id}
                  label={l.name}
                  selected={l.id === locationId}
                  onClick={() => {
                    setLocationId(l.id);
                    setStep("area");
                  }}
                />
              ))}
            </div>
          </Section>
        )}

        {step === "area" && (
          <Section title="Which area of the room?">
            <div className="grid gap-2 sm:grid-cols-3">
              {(picks?.area ?? []).map((v) => (
                <BigOption
                  key={v}
                  label={v}
                  selected={v === area}
                  onClick={() => {
                    setArea(v);
                    setStep("material");
                  }}
                />
              ))}
            </div>
          </Section>
        )}

        {step === "material" && (
          <Section title="Which material?">
            <div className="grid gap-2 sm:grid-cols-3">
              {(picks?.material ?? []).map((v) => (
                <BigOption
                  key={v}
                  label={v}
                  selected={v === material}
                  onClick={() => {
                    setMaterial(v);
                    setStep("issue");
                  }}
                />
              ))}
            </div>
          </Section>
        )}

        {step === "issue" && (
          <Section title="What is the issue?">
            <div className="grid gap-2 sm:grid-cols-3">
              {(picks?.issue_type ?? []).map((v) => (
                <BigOption
                  key={v}
                  label={v}
                  selected={v === issue}
                  onClick={() => {
                    setIssue(v);
                    setStep("assessment");
                  }}
                />
              ))}
            </div>
          </Section>
        )}

        {step === "assessment" && (
          <Section title="BMD assessment">
            <div className="grid gap-3">
              {ASSESSMENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => {
                    setAssessment(a.value);
                    setStep("details");
                  }}
                  className={cn(
                    "min-h-[72px] rounded-xl px-5 text-left text-lg font-semibold",
                    a.className,
                    assessment === a.value && "ring-4 ring-primary/40",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </Section>
        )}

        {step === "details" && (
          <Section title="Photos and notes">
            <label className="flex min-h-[64px] cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-card text-base font-semibold text-primary">
              <Camera className="h-6 w-6" />
              Take or add photos
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])}
              />
            </label>

            {files.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="relative">
                    <img
                      src={URL.createObjectURL(f)}
                      alt={f.name}
                      className="h-24 w-full rounded-md object-cover"
                    />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 rounded-full bg-foreground/70 p-1 text-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (what, where, how bad)"
              className="mt-4 min-h-[110px] text-base"
            />

            <Button onClick={save} disabled={saving} className="mt-4 h-14 w-full text-base">
              <Check className="mr-2 h-5 w-5" />
              {saving ? "Saving…" : "Save deficiency"}
            </Button>
          </Section>
        )}

        {step === "done" && (
          <Section title={savedNumber ? `${itemNo(savedNumber)} saved` : "Saved"}>
            <div className="grid gap-3">
              <Button className="h-14 text-base" onClick={() => resetItem(true)}>
                Add another in {location?.name ?? "this room"}
              </Button>
              <Button variant="secondary" className="h-14 text-base" onClick={() => resetItem(false)}>
                Next room
              </Button>
              <Button variant="outline" className="h-14 text-base" asChild>
                <Link to="/floors">Done</Link>
              </Button>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-3xl">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
