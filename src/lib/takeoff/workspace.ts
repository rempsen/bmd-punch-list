/** The takeoff workspace (OpenTakeoff, served from /takeoff/) and the notes it sends back to the tab that opened it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The workspace address for a project. Only the project id travels in it. */
export function workspaceUrl(projectId: string): string {
  if (!UUID.test(projectId)) throw new Error("Not a project id");
  return `/takeoff/index.html?project=${projectId}`;
}

/** True when a message is the workspace on this site saying this project's takeoff was saved. */
export function isSavedMessage(e: { origin: string; data: unknown }, origin: string, projectId: string): boolean {
  if (e.origin !== origin || !e.data || typeof e.data !== "object") return false;
  const d = e.data as { type?: unknown; projectId?: unknown };
  return d.type === "bmd-takeoff-saved" && d.projectId === projectId;
}
