/** Settings come in two kinds: company settings that apply to every job, and settings for the job that is open. */
export const COMPANY_TABS = ["quotes", "knowledge", "integrations", "sync", "ai", "scope", "allusers", "roles", "projects", "jobs", "templates", "scheduling"];
export const JOB_TABS = ["project", "structure", "lists", "users", "companycam"];
export type SettingsGroup = "company" | "job";

/** Tabs that were renamed, so old links and bookmarks still open the right place. Microsoft 365 now lives under Integrations. */
const RENAMED_TABS: Record<string, string> = { microsoft: "integrations" };
export function canonicalTab(tab: string | undefined): string | undefined {
  return tab === undefined ? undefined : (RENAMED_TABS[tab] ?? tab);
}

export const settingsGroup = (tab: string | undefined): SettingsGroup => (tab && JOB_TABS.includes(tab) ? "job" : "company");

export function settingsHeading(tab: string | undefined, jobName: string | null | undefined): { title: string; subtitle: string } {
  return settingsGroup(tab) === "job" ? { title: "Job settings", subtitle: jobName || "No job selected" } : { title: "Company settings", subtitle: "Apply to every job" };
}

const COMPANY_PATHS = ["/overview", "/jobs", "/new-job", "/projects", "/clients", "/pipeline", "/estimates", "/materials", "/scheduling", "/technicians", "/installation", "/catalogue", "/more", "/sign/", "/confirm/", "/daily-log"];
/** Whether a screen is about one job, so a job has to be chosen before it can open. */
export function needsJob(pathname: string, tab: string | undefined): boolean {
  if (COMPANY_PATHS.some((p) => pathname.startsWith(p))) return false;
  if (pathname.startsWith("/settings")) return settingsGroup(tab) === "job";
  return true;
}
