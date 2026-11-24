import { useMemo, useState } from "react";
import { Plus, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { roleLabel, type AppRole } from "@/lib/roles";
import { filterUsers, levelsFor, userStatus, type AdminUser, type UserFilter, type UserStatus } from "@/lib/users/logic";
import { cn } from "@/lib/utils";
import { AddUserSheet } from "./AddUserSheet";
import { STATUS, when } from "./format";
import { StatusBadge } from "./ui";
import { useAdminUsers } from "./data";
import { PersonSheet } from "./PersonSheet";

const jobText = (u: AdminUser) => (u.level === "super_admin" || u.all_jobs ? "All jobs" : u.job_count === 0 ? "No jobs" : `${u.job_count} job${u.job_count === 1 ? "" : "s"}`);

/** Company settings → Users: everyone in one place, with add, change, deactivate and delete. */
export function UsersAdmin() {
  const { user, isSuperAdmin } = useAuth();
  const { data: users = [], isLoading, error } = useAdminUsers();
  const [filter, setFilter] = useState<UserFilter>({ q: "", status: "", level: "" });
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(() => filterUsers(users, filter), [users, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const u of users) c[userStatus(u)] = (c[userStatus(u)] ?? 0) + 1;
    return c;
  }, [users]);
  const activeSuperCount = users.filter((u) => u.kind === "user" && u.is_super && u.status !== "deactivated").length;
  const open = users.find((u) => `${u.kind}:${u.id}` === openId) ?? null;
  const actor = { id: user?.id ?? "", isSuper: isSuperAdmin };
  const selectCls = "h-11 rounded-md border border-input bg-background px-3 text-sm";

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-base font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">
            {counts["active"] ?? 0} active
            {counts["invited"] ? ` · ${counts["invited"]} invited` : ""}
            {counts["expired"] ? ` · ${counts["expired"]} expired` : ""}
            {counts["deactivated"] ? ` · ${counts["deactivated"]} deactivated` : ""}. Each person has a level and the jobs they can open.
          </p>
        </div>
        <Button className="h-11" onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden /> Add user
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="h-11 pl-9" placeholder="Search name, email or company" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} aria-label="Search users" />
        </div>
        <select className={selectCls} aria-label="Status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as UserFilter["status"] })}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS) as UserStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </select>
        <select className={selectCls} aria-label="Level" value={filter.level} onChange={(e) => setFilter({ ...filter, level: e.target.value as AppRole | "" })}>
          <option value="">All levels</option>
          {levelsFor(true).map((l) => (
            <option key={l} value={l}>
              {roleLabel(l)}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="p-4 text-sm text-destructive">Could not load users: {error.message}</p>
      ) : isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
          <UserRound className="h-8 w-8" aria-hidden />
          {users.length === 0 ? "No users yet. Add the first one." : "Nobody matches those filters."}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((u) => {
            const st = userStatus(u);
            return (
              <li key={`${u.kind}:${u.id}`}>
                <button
                  type="button"
                  onClick={() => setOpenId(`${u.kind}:${u.id}`)}
                  className={cn("grid min-h-16 w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/60 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_9rem_7rem_8rem]", st === "deactivated" && "opacity-70")}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {u.full_name || u.email}
                      {u.id === user?.id ? <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {u.email}
                      {u.company ? ` · ${u.company}` : ""}
                    </span>
                  </span>
                  <span className="hidden truncate text-sm sm:block">{roleLabel(u.level)}</span>
                  <span className="hidden text-sm text-muted-foreground sm:block">{jobText(u)}</span>
                  <span className="justify-self-end sm:justify-self-start">
                    <StatusBadge status={st} />
                  </span>
                  <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:text-sm">
                    <span className="sm:hidden">
                      {roleLabel(u.level)} · {jobText(u)} ·{" "}
                    </span>
                    {u.kind === "invite" ? (u.invite_sent_at ? `Sent ${when(u.invite_sent_at)}` : "Not sent") : u.last_sign_in_at ? when(u.last_sign_in_at) : "Never signed in"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AddUserSheet open={adding} onOpenChange={setAdding} actorIsSuper={isSuperAdmin} />
      <PersonSheet person={open} onClose={() => setOpenId(null)} actor={actor} activeSuperCount={activeSuperCount} />
    </section>
  );
}
