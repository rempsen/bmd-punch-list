import { useAuth } from "@/lib/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Assessment, Status } from "./bmd";

export type Floor = { id: string; project_id: string; number: number; label: string; sort_order: number };
export type LocationRow = {
  id: string;
  floor_id: string;
  type: "room" | "common_area";
  name: string;
  room_type: string | null;
  sort_order: number;
};
export type DefRow = {
  id: string;
  project_id: string;
  item_number: number;
  location_id: string;
  area: string;
  material: string;
  issue_type: string;
  description: string | null;
  assessment: Assessment;
  status: Status;
  assigned_to: string | null;
  assigned_trade: string | null;
  assigned_at: string | null;
  responsible_party: "bmd" | "trade" | "client" | "unassigned";
  due_date: string | null;
  client_decision_note: string | null;
  is_sample: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  locations?: {
    id: string;
    name: string;
    type: "room" | "common_area";
    floor_id: string;
    floors?: { number: number; label: string } | null;
  } | null;
};
export type PhotoRow = {
  id: string;
  deficiency_id: string;
  storage_path: string;
  kind: "before" | "after";
  caption: string | null;
  taken_at: string;
};
export type EventRow = {
  id: string;
  deficiency_id: string;
  user_id: string | null;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
};
export type Profile = { id: string; email: string | null; full_name: string | null };

const unwrap = <T,>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
};

export function useProject() {
  const { projectId } = useAuth();
  return useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("id", projectId!).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export type ProjectContact = {
  id: string;
  project_id: string;
  kind: string;
  name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  phone_mobile: string | null;
  phone_office: string | null;
  is_primary: boolean;
  sort_order: number;
};

export function useContacts(projectId?: string | null) {
  return useQuery({
    queryKey: ["contacts", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_contacts")
        .select("*")
        .eq("project_id", projectId!)
        .order("sort_order");
      if (error) throw new Error(error.message);
      return (data ?? []) as ProjectContact[];
    },
  });
}

export function useScopes(projectId?: string | null) {
  return useQuery({
    queryKey: ["scopes", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_scopes").select("*").eq("project_id", projectId!);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** "Client: Hyatt Centric, contact Jane Smith (PM) · 204-555-0100" */
export function clientLine(clientName: string | null | undefined, contacts: ProjectContact[]) {
  const primary = contacts.find((c) => c.kind === "client" && c.is_primary) ?? contacts.find((c) => c.kind === "client");
  const company = primary?.company || clientName;
  if (!company && !primary?.name) return "";
  const who = primary?.name ? `, contact ${primary.name}${primary.title ? ` (${primary.title})` : ""}` : "";
  const reach = [primary?.phone_mobile || primary?.phone_office, primary?.email].filter(Boolean).join(" · ");
  return `Client: ${company ?? "—"}${who}${reach ? ` · ${reach}` : ""}`;
}

export function useFloors(projectId?: string) {
  return useQuery({
    queryKey: ["floors", projectId],
    enabled: !!projectId,
    queryFn: async () =>
      unwrap<Floor[]>(
        await supabase
          .from("floors")
          .select("*")
          .eq("project_id", projectId!)
          .order("sort_order"),
      ),
  });
}

export function useLocations(floorIds: string[]) {
  const key = [...floorIds].sort().join("|");
  return useQuery({
    queryKey: ["locations", key],
    enabled: floorIds.length > 0,
    queryFn: async () =>
      unwrap<LocationRow[]>(
        await supabase
          .from("locations")
          .select("*")
          .in("floor_id", floorIds)
          .order("sort_order"),
      ),
  });
}

export function usePickLists() {
  const { projectId } = useAuth();
  return useQuery({
    queryKey: ["pick_lists", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const rows = unwrap<{ id: string; kind: string; value: string; sort_order: number; active: boolean }[]>(
        await supabase.from("pick_lists").select("*").eq("project_id", projectId!).order("sort_order"),
      );
      return {
        all: rows,
        area: rows.filter((r) => r.kind === "area" && r.active).map((r) => r.value),
        material: rows.filter((r) => r.kind === "material" && r.active).map((r) => r.value),
        issue_type: rows.filter((r) => r.kind === "issue_type" && r.active).map((r) => r.value),
      };
    },
  });
}

/** client_decision_note is served through a permission-aware computed field. */
export const DEF_SELECT =
  "id,project_id,item_number,location_id,area,material,issue_type,description,assessment,status,assigned_to,assigned_trade,assigned_at,responsible_party,due_date,is_sample,created_by,created_at,updated_at,closed_at,locations(id,name,type,floor_id,floors(number,label))";

async function withNotes<T extends { id: string; client_decision_note?: string | null }>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const { data } = await supabase.rpc("decision_notes", { _ids: rows.map((r) => r.id) });
  const map = new Map((data ?? []).map((n: { id: string; note: string | null }) => [n.id, n.note]));
  return rows.map((r) => ({ ...r, client_decision_note: map.get(r.id) ?? null }));
}

export function useDeficiencies(projectId?: string) {
  return useQuery({
    queryKey: ["deficiencies", projectId],
    enabled: !!projectId,
    queryFn: async () =>
      withNotes(
        unwrap<DefRow[]>(
          await supabase
            .from("deficiencies")
            .select(DEF_SELECT as "*")
            .eq("project_id", projectId!)
            .order("item_number", { ascending: false }),
        ),
      ),
  });
}

export function useDeficiency(id: string) {
  return useQuery({
    queryKey: ["deficiency", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deficiencies")
        .select(DEF_SELECT as "*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const [row] = await withNotes([data as unknown as DefRow]);
      return row ?? null;
    },
  });
}

export function usePhotos(deficiencyIds: string[]) {
  const key = [...deficiencyIds].sort().join("|");
  return useQuery({
    queryKey: ["photos", key],
    enabled: deficiencyIds.length > 0,
    queryFn: async () =>
      unwrap<PhotoRow[]>(
        await supabase
          .from("deficiency_photos")
          .select("*")
          .in("deficiency_id", deficiencyIds)
          .order("taken_at"),
      ),
  });
}

export function useEvents(deficiencyId: string) {
  return useQuery({
    queryKey: ["events", deficiencyId],
    queryFn: async () =>
      unwrap<EventRow[]>(
        await supabase
          .from("deficiency_events")
          .select("*")
          .eq("deficiency_id", deficiencyId)
          .order("created_at", { ascending: false }),
      ),
  });
}

export function useAllEvents(projectId?: string) {
  return useQuery({
    queryKey: ["all-events", projectId],
    enabled: !!projectId,
    queryFn: async () =>
      unwrap<EventRow[]>(
        await supabase
          .from("deficiency_events")
          .select("*")
          .order("created_at", { ascending: true })
          .limit(5000),
      ),
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () =>
      unwrap<Profile[]>(await supabase.from("profiles").select("id,email,full_name").order("email")),
  });
}

export function useUserRoles() {
  return useQuery({
    queryKey: ["user_roles"],
    queryFn: async () =>
      unwrap<{ id: string; user_id: string; role: string }[]>(
        await supabase.from("user_roles").select("*"),
      ),
  });
}

export function useInvalidateDeficiencies() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["deficiencies"] });
    void qc.invalidateQueries({ queryKey: ["deficiency"] });
    void qc.invalidateQueries({ queryKey: ["events"] });
    void qc.invalidateQueries({ queryKey: ["all-events"] });
    void qc.invalidateQueries({ queryKey: ["photos"] });
  };
}

export function useUpdateDeficiency() {
  const invalidate = useInvalidateDeficiencies();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase
        .from("deficiencies")
        .update(patch as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export async function addComment(deficiencyId: string, userId: string | null, note: string) {
  const { error } = await supabase.from("deficiency_events").insert({
    deficiency_id: deficiencyId,
    user_id: userId,
    event_type: "comment",
    note,
  });
  if (error) throw new Error(error.message);
}

type FloorLike = { number: number; label?: string | null } | null | undefined;
/** Full floor name, e.g. "Basement" or "Floor 3". */
export const floorLabel = (f: FloorLike) =>
  f ? (f.label?.trim() || `Floor ${f.number}`) : "—";
/** Compact name for tabs/buttons: "Basement", "1", "2"… */
export const floorShort = (f: FloorLike) => {
  if (!f) return "—";
  const l = f.label?.trim();
  return !l || /^floor\s+\d+$/i.test(l) ? String(f.number) : l;
};
export const floorOf = (d: DefRow) => d.locations?.floors?.number ?? 0;
export const locationName = (d: DefRow) => d.locations?.name ?? "—";
