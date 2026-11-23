/** Settings come in two kinds: company settings that apply to every job, and settings for the job that is open. */
export const COMPANY_TABS = ["quotes", "microsoft", "allusers", "roles", "projects", "jobs"];
export const JOB_TABS = ["project", "structure", "lists", "users", "companycam"];
export type SettingsGroup = "company" | "job";

export const settingsGroup = (tab: string | undefined): SettingsGroup => (tab && JOB_TABS.includes(tab) ? "job" : "company");

export function settingsHeading(tab: string | undefined, jobName: string | null | undefined): { title: string; subtitle: string } {
  return settingsGroup(tab) === "job" ? { title: "Job settings", subtitle: jobName || "No job selected" } : { title: "Company settings", subtitle: "Apply to every job" };
}

const COMPANY_PATHS = ["/jobs", "/new-job", "/projects", "/clients", "/pipeline", "/catalogue"];
/** Whether a screen is about one job, so a job has to be chosen before it can open. */
export function needsJob(pathname: string, tab: string | undefined): boolean {
  if (COMPANY_PATHS.some((p) => pathname.startsWith(p))) return false;
  if (pathname.startsWith("/settings")) return settingsGroup(tab) === "job";
  return true;
}
