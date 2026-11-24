import { roleLabel, type AppRole } from "@/lib/roles";

/** One row of the Users screen: a person with an account, or an invite to someone who has not signed up yet. */
export type AdminUser = {
  kind: "user" | "invite";
  id: string;
  email: string;
  full_name: string | null;
  company: string | null;
  level: AppRole;
  all_jobs: boolean;
  status: "active" | "deactivated" | "invited" | "expired";
  is_super: boolean;
  last_sign_in_at: string | null;
  job_count: number;
  jobs: { project_id: string; role: AppRole | null }[] | null;
  invite_id: string | null;
  invite_token: string | null;
  invite_sent_at: string | null;
  invite_error: string | null;
  has_records: boolean;
  created_at: string;
};

export type UserStatus = "active" | "invited" | "expired" | "deactivated";

export function userStatus(u: Pick<AdminUser, "kind" | "status" | "last_sign_in_at">): UserStatus {
  if (u.status === "deactivated") return "deactivated";
  if (u.kind === "invite") return u.status === "expired" ? "expired" : "invited";
  return u.last_sign_in_at ? "active" : "invited";
}

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** What a person can reach, in one line: "Client on Hyatt Centric and Test Take Off", "BMD manager on all jobs (Viewer on Hyatt)". */
export function accessSummary(level: AppRole, allJobs: boolean, jobs: { name: string; role: AppRole | null }[]): string {
  const lvl = roleLabel(level);
  if (level === "super_admin") return "Super admin on all jobs";
  const exceptions = jobs.filter((j) => j.role && j.role !== level);
  const extra = exceptions.length ? ` (${exceptions.map((j) => `${roleLabel(j.role)} on ${j.name}`).join("; ")})` : "";
  if (allJobs) return `${lvl} on all jobs${extra}`;
  if (jobs.length === 0) return `${lvl}, no jobs yet`;
  if (jobs.length <= 2 && !exceptions.length) return `${lvl} on ${list(jobs.map((j) => j.name))}`;
  return `${lvl} on ${jobs.length} job${jobs.length === 1 ? "" : "s"}${extra}`;
}

export type AdminAction = "edit" | "deactivate" | "reactivate" | "delete";
export type Verdict = { ok: true } | { ok: false; why: string };

/** The same limits the database enforces, so buttons can say why they are unavailable. */
export function canAct(actor: { id: string; isSuper: boolean }, target: Pick<AdminUser, "id" | "is_super" | "status" | "has_records">, action: AdminAction, activeSuperCount: number): Verdict {
  if (target.is_super && !actor.isSuper) return { ok: false, why: "Only a super admin can change a super admin" };
  const active = target.status !== "deactivated";
  if (action === "deactivate") {
    if (target.id === actor.id) return { ok: false, why: "You can't deactivate yourself" };
    if (!active) return { ok: false, why: "Already deactivated" };
    if (target.is_super && activeSuperCount <= 1) return { ok: false, why: "BMD needs at least one active super admin" };
  }
  if (action === "reactivate" && active) return { ok: false, why: "Already active" };
  if (action === "delete") {
    if (target.id === actor.id) return { ok: false, why: "You can't delete yourself" };
    if (active) return { ok: false, why: "Deactivate first" };
    if (target.has_records) return { ok: false, why: "Has records on jobs; keep them deactivated" };
  }
  return { ok: true };
}

export type UserFilter = { q: string; status: "" | UserStatus; level: "" | AppRole };

export function filterUsers(users: AdminUser[], f: UserFilter): AdminUser[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return users.filter((u) => {
    if (f.status && userStatus(u) !== f.status) return false;
    if (f.level && u.level !== f.level) return false;
    const hay = [u.full_name, u.email, u.company].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const LEVEL_ORDER: AppRole[] = ["super_admin", "bmd_manager", "bmd_field", "trade", "client", "viewer"];
/** The levels this admin may hand out. */
export const levelsFor = (actorIsSuper: boolean): AppRole[] => LEVEL_ORDER.filter((l) => actorIsSuper || l !== "super_admin");

export type JobPick = { projectId: string; role: AppRole | null };
export type InviteInput = { email: string; fullName: string; company: string; level: AppRole; allJobs: boolean; jobs: JobPick[] };
export type InviteValue = Omit<InviteInput, "company"> & { company: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Checks an invite before it is sent; the database checks the same things again. */
export function validateInvite(i: InviteInput): { ok: true; value: InviteValue } | { ok: false; why: string } {
  const email = i.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, why: "Enter a valid email address" };
  if (!LEVEL_ORDER.includes(i.level)) return { ok: false, why: "Choose a level" };
  if (i.jobs.some((j) => !UUID.test(j.projectId))) return { ok: false, why: "Unknown job" };
  if (i.jobs.some((j) => j.role !== null && !LEVEL_ORDER.includes(j.role))) return { ok: false, why: "Choose a level" };
  if (!i.allJobs && i.level !== "super_admin" && i.jobs.length === 0) return { ok: false, why: "Choose at least one job, or give access to all jobs" };
  return { ok: true, value: { ...i, email, fullName: i.fullName.trim(), company: i.company.trim() || null } };
}

/** BMD staff levels: the people who work every job. Trades, clients and viewers are invited job by job. */
export const STAFF_LEVELS: readonly AppRole[] = ["super_admin", "bmd_manager", "bmd_field"];
export const isStaffLevel = (level: AppRole) => STAFF_LEVELS.includes(level);

/**
 * Dan's rule (24 Nov 2026, "until further notice"): while the user base is small, every BMD staff member is on every
 * job, new ones included. Trades and clients still get only the jobs they are picked for. An admin can still switch a
 * person to selected jobs after this default is applied.
 */
export const defaultAllJobs = (level: AppRole) => isStaffLevel(level);
