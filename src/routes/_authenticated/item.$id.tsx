import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AssessmentBadge, StatusBadge } from "@/components/badges";
import { StatusActions } from "@/components/StatusActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ASSESSMENTS, itemNo, STATUS_LABEL, type Assessment } from "@/lib/bmd";
import {
  addComment,
  useDeficiency,
  useEvents,
  useInvalidateDeficiencies,
  usePhotos,
  usePickLists,
  useProfiles,
  useUpdateDeficiency,
} from "@/lib/data";
import { useSignedUrls, uploadDeficiencyPhoto } from "@/lib/photos";

export const Route = createFileRoute("/_authenticated/item/$id")({
  component: ItemDetail,
});

function ItemDetail() {
  const { id } = Route.useParams();
  const { user, isAdmin, isClient, canCapture } = useAuth();
  const { data: item, isLoading } = useDeficiency(id);
  const { data: photos = [] } = usePhotos([id]);
  const { data: events = [] } = useEvents(id);
  const { data: picks } = usePickLists();
  const { data: profiles = [] } = useProfiles();
  const update = useUpdateDeficiency();
  const invalidate = useInvalidateDeficiencies();
  const [comment, setComment] = useState("");
  const [uploading, setUploading] = useState(false);

  const paths = useMemo(() => photos.map((p) => p.storage_path), [photos]);
  const { data: urls = {} } = useSignedUrls(paths);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!item) return <div className="p-6 text-sm text-muted-foreground">Item not found.</div>;

  const editable = canCapture;
  const patch = (p: Record<string, unknown>) =>
    update.mutate({ id, patch: p }, { onError: (e) => toast.error(e.message) });

  const upload = async (files: FileList | null, kind: "before" | "after") => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadDeficiencyPhoto(id, file, kind, user?.id);
      }
      invalidate();
      toast.success("Photos uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const postComment = async () => {
    if (!comment.trim()) return;
    try {
      await addComment(id, user?.id ?? null, comment.trim());
      setComment("");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add comment");
    }
  };

  const removeItem = async () => {
    const { error } = await supabase.from("deficiencies").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      invalidate();
      toast.success("Item deleted");
      history.back();
    }
  };

  return (
    <div>
      <PageHeader
        title={`${itemNo(item.item_number)} · ${item.locations?.name ?? ""}`}
        subtitle={
          item.locations?.floors ? `Floor ${item.locations.floors.number} · ${item.area}` : item.area
        }
        actions={
          <Button variant="ghost" className="h-11" asChild>
            <Link to="/list">
              <ArrowLeft className="mr-2 h-4 w-4" /> All items
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 p-4 md:grid-cols-3 md:p-6">
        <div className="space-y-6 md:col-span-2">
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <AssessmentBadge value={item.assessment} />
              <StatusBadge value={item.status} />
            </div>
            <div className="mt-4">
              <StatusActions id={item.id} status={item.status} />
            </div>
            {(isClient || isAdmin) && item.status === "awaiting_client" && (
              <div className="mt-4">
                <Textarea
                  placeholder="Client decision note"
                  defaultValue={item.client_decision_note ?? ""}
                  onBlur={(e) => patch({ client_decision_note: e.target.value || null })}
                  className="min-h-[80px]"
                />
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase">Photos</h2>
            {photos.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">No photos yet.</p>
            )}
            {(["before", "after"] as const).map((kind) => {
              const list = photos.filter((p) => p.kind === kind);
              if (list.length === 0) return null;
              return (
                <div key={kind} className="mt-3">
                  <p className="mb-2 text-xs font-semibold uppercase">{kind}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {list.map((p) => (
                      <a
                        key={p.id}
                        href={urls[p.storage_path]}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                      >
                        <img
                          src={urls[p.storage_path]}
                          alt={`${kind} photo`}
                          className="h-28 w-full rounded-md object-cover"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
            {editable && (
              <div className="mt-4 flex flex-wrap gap-2">
                {(["before", "after"] as const).map((kind) => (
                  <label
                    key={kind}
                    className="flex min-h-[48px] cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-medium"
                  >
                    <Camera className="h-4 w-4" /> Add {kind} photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => void upload(e.target.files, kind)}
                    />
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase">Details</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Area">
                <PickSelect
                  value={item.area}
                  options={picks?.area ?? []}
                  disabled={!editable}
                  onChange={(v) => patch({ area: v })}
                />
              </Field>
              <Field label="Material">
                <PickSelect
                  value={item.material}
                  options={picks?.material ?? []}
                  disabled={!editable}
                  onChange={(v) => patch({ material: v })}
                />
              </Field>
              <Field label="Issue type">
                <PickSelect
                  value={item.issue_type}
                  options={picks?.issue_type ?? []}
                  disabled={!editable}
                  onChange={(v) => patch({ issue_type: v })}
                />
              </Field>
              <Field label="Assessment">
                <Select
                  value={item.assessment}
                  disabled={!isAdmin}
                  onValueChange={(v) => patch({ assessment: v as Assessment })}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSESSMENTS.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Assigned to">
                <Select
                  value={item.assigned_to ?? "none"}
                  disabled={!editable}
                  onValueChange={(v) => patch({ assigned_to: v === "none" ? null : v })}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name ?? p.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Due date">
                <Input
                  type="date"
                  className="h-11"
                  disabled={!editable}
                  defaultValue={item.due_date ?? ""}
                  onBlur={(e) => patch({ due_date: e.target.value || null })}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Description">
                <Textarea
                  defaultValue={item.description ?? ""}
                  disabled={!editable}
                  onBlur={(e) => patch({ description: e.target.value || null })}
                  className="min-h-[90px]"
                />
              </Field>
            </div>
            {isAdmin && (
              <Button variant="destructive" className="mt-4 h-11" onClick={removeItem}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete item
              </Button>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase">Comments</h2>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment"
              className="mt-2 min-h-[80px]"
            />
            <Button className="mt-2 h-11 w-full" onClick={postComment}>
              Post comment
            </Button>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase">Activity</h2>
            <ol className="mt-3 space-y-3">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-border pl-3 text-sm">
                  <p className="font-medium">{describeEvent(e.event_type, e.from_value, e.to_value)}</p>
                  {e.note && <p className="text-muted-foreground">{e.note}</p>}
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function describeEvent(type: string, from: string | null, to: string | null) {
  const label = (v: string | null) =>
    v && v in STATUS_LABEL ? STATUS_LABEL[v as keyof typeof STATUS_LABEL] : (v ?? "—");
  switch (type) {
    case "created":
      return `Item created (${label(to)})`;
    case "status_change":
      return `Status ${label(from)} → ${label(to)}`;
    case "assessment_change":
      return `Assessment ${from} → ${to}`;
    case "assignment":
      return "Assignment changed";
    case "comment":
      return "Comment";
    default:
      return type;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function PickSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean | undefined;
}) {
  const isDisabled = disabled ?? false;
  const list = options.includes(value) ? options : [value, ...options];
  return (
    <Select value={value} onValueChange={onChange} disabled={isDisabled}>
      <SelectTrigger className="h-11">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {list.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
