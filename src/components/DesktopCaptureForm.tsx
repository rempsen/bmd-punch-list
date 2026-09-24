import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { SearchSelect } from "@/components/SearchSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ASSESSMENTS, itemNo, type Assessment } from "@/lib/bmd";
import { floorLabel, useFloors, useInvalidateDeficiencies, useLocations, usePickLists, useProject } from "@/lib/data";
import { useProjectPeople } from "@/lib/assign";
import { assigneePatch, ResponsibleFields } from "@/components/ResponsibleFields";
import { loadLastResp, saveLastResp, type Responsible } from "@/lib/responsible";
import { uploadDeficiencyPhoto } from "@/lib/photos";
import { cn } from "@/lib/utils";

type Photo = { key: string; file: File; url: string; kind: "before" | "after" };
type Errors = Partial<Record<"floor" | "location" | "area" | "material" | "issue" | "assessment", string>>;

export function DesktopCaptureForm() {
  const { user, can, projectId } = useAuth();
  const isAdmin = can("manage_settings");
  const navigate = useNavigate();
  const { data: project } = useProject();
  const { data: floors = [] } = useFloors(project?.id);
  const floorIds = useMemo(() => floors.map((f) => f.id), [floors]);
  const { data: locations = [], refetch: refetchLocations } = useLocations(floorIds);
  const { data: picks } = usePickLists();
  const { data: people = [] } = useProjectPeople(projectId);
  const invalidate = useInvalidateDeficiencies();

  const [floorId, setFloorId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [material, setMaterial] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [responsible, setResponsible] = useState<Responsible>("unassigned");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [lastHint, setLastHint] = useState<string | null>(null);
  useEffect(() => {
    const last = loadLastResp(projectId);
    if (last && (last.responsible !== "unassigned" || last.assignee)) {
      setResponsible(last.responsible);
      setAssignee(last.assignee);
      setLastHint("Same as last item — change if this one is for someone else.");
    }
  }, [projectId]);
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const lastFloor = localStorage.getItem("bmd:lastFloor");
    const lastLocation = localStorage.getItem("bmd:lastLocation");
    if (lastFloor && floors.some((f) => f.id === lastFloor)) {
      setFloorId(lastFloor);
      if (lastLocation) setLocationId(lastLocation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorIds.join("|")]);

  const floorLocs = locations.filter((l) => l.floor_id === floorId);
  const locOptions = [
    ...floorLocs.filter((l) => l.type === "room").map((l) => ({ value: l.id, label: l.name, group: "Rooms" })),
    ...floorLocs.filter((l) => l.type === "common_area").map((l) => ({ value: l.id, label: l.name, group: "Common areas" })),
  ];
  const opts = (list?: string[]) => (list ?? []).map((v) => ({ value: v, label: v }));

  const addFiles = (list: FileList | File[] | null) => {
    const imgs = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setPhotos((p) => [
      ...p,
      ...imgs.map((file) => ({ key: `${Date.now()}-${Math.random()}`, file, url: URL.createObjectURL(file), kind: "before" as const })),
    ]);
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const addLocation = async (name: string) => {
    if (!floorId) return;
    const { data, error } = await supabase
      .from("locations")
      .insert({ floor_id: floorId, type: "room", name, sort_order: 999 })
      .select("id")
      .maybeSingle();
    if (error) return void toast.error(error.message);
    await refetchLocations();
    if (data) setLocationId(data.id);
  };

  const validate = () => {
    const e: Errors = {};
    if (!floorId) e.floor = "Choose a floor.";
    if (!locationId) e.location = "Choose a room or area.";
    if (!area) e.area = "Choose an area.";
    if (!material) e.material = "Choose a material.";
    if (!issue) e.issue = "Choose an issue type.";
    if (!assessment) e.assessment = "Choose an assessment.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const clearItem = () => {
    setArea(null);
    setMaterial(null);
    setIssue(null);
    setAssessment(null);
    setDue("");
    setNote("");
    setPhotos([]);
    setErrors({});
  };

  const save = async (then: "another" | "open" | "stay") => {
    if (!project || !validate()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("deficiencies")
        .insert({
          project_id: project.id,
          location_id: locationId!,
          area: area!,
          material: material!,
          issue_type: issue!,
          description: note.trim() || null,
          assessment: assessment!,
          created_by: user?.id ?? null,
          responsible_party: responsible,
          ...assigneePatch(assignee, people),
          due_date: due || null,
        })
        .select("id,item_number")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Could not save the item");
      for (const p of photos) await uploadDeficiencyPhoto(data.id, p.file, p.kind, user?.id);
      localStorage.setItem("bmd:lastFloor", floorId ?? "");
      localStorage.setItem("bmd:lastLocation", locationId!);
      saveLastResp(project.id, { responsible, assignee });
      if (responsible !== "unassigned" || assignee) setLastHint("Same as last item — change if this one is for someone else.");
      invalidate();
      toast.success(`${itemNo(data.item_number)} saved`);
      if (then === "open") void navigate({ to: "/item/$id", params: { id: data.id } });
      else {
        clearItem();
        if (then === "stay") setLocationId(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onPaste={onPaste}>
      <PageHeader title="Add a deficiency" subtitle={project?.name} />
      <form
        className="mx-auto max-w-5xl p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save("stay");
        }}
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <F label="Floor" id="f-floor" error={errors.floor}>
            <select
              id="f-floor"
              value={floorId ?? ""}
              onChange={(e) => {
                setFloorId(e.target.value || null);
                setLocationId(null);
              }}
              className={cn("h-11 w-full rounded-md border bg-background px-3 text-sm", errors.floor ? "border-destructive" : "border-input")}
            >
              <option value="">Select a floor…</option>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>{floorLabel(f)}</option>
              ))}
            </select>
          </F>
          <F label="Location" id="f-loc" error={errors.location}>
            <SearchSelect
              id="f-loc"
              value={locationId}
              onChange={setLocationId}
              options={locOptions}
              disabled={!floorId}
              invalid={!!errors.location}
              placeholder={floorId ? "Select a room or area…" : "Choose a floor first"}
              onCreate={isAdmin ? addLocation : undefined}
              createLabel="Add room"
            />
          </F>
          <F label="Area" id="f-area" error={errors.area}>
            <SearchSelect id="f-area" value={area} onChange={setArea} options={opts(picks?.area)} invalid={!!errors.area} />
          </F>
          <F label="Material" id="f-mat" error={errors.material}>
            <SearchSelect id="f-mat" value={material} onChange={setMaterial} options={opts(picks?.material)} invalid={!!errors.material} />
          </F>
          <F label="Issue type" id="f-issue" error={errors.issue}>
            <SearchSelect id="f-issue" value={issue} onChange={setIssue} options={opts(picks?.issue_type)} invalid={!!errors.issue} />
          </F>
          <F label="Assessment" error={errors.assessment}>
            <div role="radiogroup" className="grid grid-cols-3 gap-2">
              {ASSESSMENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  role="radio"
                  aria-checked={assessment === a.value}
                  onClick={() => setAssessment(a.value)}
                  className={cn(
                    "min-h-11 rounded-md px-2 text-sm font-semibold",
                    a.className,
                    assessment === a.value ? "ring-2 ring-primary ring-offset-2" : "opacity-70 hover:opacity-100",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </F>
          <div className="md:col-span-2">
            <ResponsibleFields
              projectId={project?.id}
              responsible={responsible}
              onResponsible={setResponsible}
              assignee={assignee}
              onAssignee={(v) => {
                setAssignee(v);
                setLastHint(null);
              }}
              hint={lastHint}
            />
          </div>
          <F label="Due date (optional)" id="f-due">
            <Input id="f-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-11" />
          </F>
          <div />
          <F label="Description" id="f-desc" className="col-span-2">
            <Textarea
              id="f-desc"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What, where, how bad"
              className="min-h-[110px]"
            />
          </F>
          <F label="Photos" className="col-span-2">
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                "flex min-h-[110px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                dragOver ? "border-primary bg-primary/5" : "border-border bg-card",
              )}
            >
              <ImagePlus className="h-6 w-6 text-primary" />
              <span className="font-medium text-foreground">Drop photos here, click to browse, or paste</span>
              <span>Multiple images allowed</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {photos.length > 0 && (
              <div className="mt-3 grid grid-cols-4 gap-3 lg:grid-cols-6">
                {photos.map((p) => (
                  <div key={p.key} className="rounded-md border border-border bg-card p-1.5">
                    <div className="relative">
                      <img src={p.url} alt={p.file.name} className="h-24 w-full rounded object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => setPhotos((all) => all.filter((x) => x.key !== p.key))}
                        className="absolute top-1 right-1 rounded-full bg-foreground/70 p-1 text-background"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1 text-xs">
                      {(["before", "after"] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setPhotos((all) => all.map((x) => (x.key === p.key ? { ...x, kind: k } : x)))}
                          className={cn(
                            "rounded py-1 font-medium capitalize",
                            p.kind === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </F>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" asChild>
            <Link to="/dashboard">Cancel</Link>
          </Button>
          <Button type="submit" variant="outline" disabled={saving}>Save</Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => void save("open")}>
            Save and open item
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save("another")}>
            {saving ? "Saving…" : "Save and add another"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function F({
  label,
  id,
  error,
  className,
  children,
}: {
  label: string;
  id?: string;
  error?: string | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
