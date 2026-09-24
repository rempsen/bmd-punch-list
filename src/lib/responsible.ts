export type Responsible = "bmd" | "trade" | "client" | "unassigned";

export const RESPONSIBLE: { value: Responsible; label: string; short: string }[] = [
  { value: "unassigned", label: "Not yet assigned", short: "Not yet assigned" },
  { value: "bmd", label: "BMD Materials (our crew)", short: "BMD Materials" },
  { value: "trade", label: "Trade / subcontractor", short: "Trade / sub" },
  { value: "client", label: "Client / other", short: "Client / other" },
];

export const respLabel = (r?: string | null) => RESPONSIBLE.find((x) => x.value === r)?.short ?? "Not yet assigned";

/** Session memory of the last responsible party + assignee, per job. */
type Last = { responsible: Responsible; assignee: string | null };
const key = (projectId: string) => `bmd:last-resp:${projectId}`;
export function loadLastResp(projectId?: string | null): Last | null {
  if (!projectId || typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(key(projectId));
    return v ? (JSON.parse(v) as Last) : null;
  } catch {
    return null;
  }
}
export function saveLastResp(projectId: string | null | undefined, v: Last) {
  if (!projectId) return;
  try {
    sessionStorage.setItem(key(projectId), JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
