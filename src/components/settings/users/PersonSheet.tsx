import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Send } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { roleLabel, type AppRole } from "@/lib/roles";
import { accessSummary, canAct, userStatus, type AdminUser, type JobPick } from "@/lib/users/logic";
import { deactivateUser, deleteUser, reactivateUser, resendUserInvite } from "@/lib/users/users.functions";
import { errText, useJobOptions, useRefreshUsers, useUserJobs, useUserLog, type JobOption } from "./data";
import { JobAccessPicker } from "./JobAccessPicker";
import { LevelPicker } from "./LevelPicker";
import { when } from "./format";
import { StatusBadge } from "./ui";

const ACTIONS: Record<string, string> = { saved: "Access changed", deactivated: "Deactivated", reactivated: "Reactivated", invited: "Invited", invite_cancelled: "Invite cancelled", deleted: "Deleted" };

/** One person: their access, their invite, deactivation and deletion, and who changed what. */
export function PersonSheet({ person, onClose, actor, activeSuperCount }: { person: AdminUser | null; onClose: () => void; actor: { id: string; isSuper: boolean }; activeSuperCount: number }) {
  return (
    <Sheet open={!!person} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {person && (person.kind === "invite" ? <InviteBody invite={person} onClose={onClose} actor={actor} /> : <UserBody key={person.id} person={person} onClose={onClose} actor={actor} activeSuperCount={activeSuperCount} />)}
      </SheetContent>
    </Sheet>
  );
}

function Header({ p }: { p: AdminUser }) {
  return (
    <SheetHeader className="border-b border-border p-5 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <SheetTitle className="text-lg">{p.full_name || p.email}</SheetTitle>
        <StatusBadge status={userStatus(p)} />
      </div>
      <SheetDescription>
        {p.email}
        {p.company ? ` · ${p.company}` : ""}
      </SheetDescription>
    </SheetHeader>
  );
}

const inviteLink = (token: string, email: string) => `${window.location.origin}/auth?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

function InviteBody({ invite, onClose, actor }: { invite: AdminUser; onClose: () => void; actor: { id: string; isSuper: boolean } }) {
  const { data: jobs = [] } = useJobOptions();
  const refresh = useRefreshUsers();
  const resend = useServerFn(resendUserInvite);
  const [busy, setBusy] = useState(false);
  const names = new Map(jobs.map((j) => [j.id, j.name]));
  const locked = invite.is_super && !actor.isSuper;
  const summary = accessSummary(invite.level, invite.all_jobs, (invite.jobs ?? []).map((j) => ({ name: names.get(j.project_id) ?? "a job", role: j.role })));
  const doResend = async () => {
    setBusy(true);
    try {
      const r = await resend({ data: { inviteId: invite.invite_id! } });
      if (r.ok) toast.success(`Invitation sent to ${invite.email}`);
      else toast.error(`Not sent: ${r.error}`, { duration: 10000 });
      refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    const { error } = await supabase.rpc("admin_cancel_invite", { _invite: invite.invite_id! });
    if (error) return void toast.error(error.message);
    toast.success("Invite cancelled");
    refresh();
    onClose();
  };
  return (
    <>
      <Header p={invite} />
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <Block title="Invitation">
          <p className="text-sm">
            Will join as <span className="font-medium">{summary}</span>.
          </p>
          <p className="text-sm text-muted-foreground">
            {invite.status === "expired" ? "This invitation has expired. Resend it to give them another 14 days." : invite.invite_sent_at ? `Last sent ${when(invite.invite_sent_at)}.` : "Not emailed yet."}
          </p>
          {invite.invite_error && <p className="text-sm text-destructive">Last send failed: {invite.invite_error}</p>}
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <Button className="h-11" disabled={busy} onClick={() => void doResend()}>
                <Send className="mr-2 h-4 w-4" aria-hidden /> {busy ? "Sending…" : invite.invite_sent_at ? "Resend invitation" : "Send invitation"}
              </Button>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void navigator.clipboard.writeText(inviteLink(invite.invite_token!, invite.email)).then(() => toast.success("Sign-up link copied"))}
              >
                <Copy className="mr-2 h-4 w-4" aria-hidden /> Copy sign-up link
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">To change their access before they sign up, cancel this invite and add them again.</p>
        </Block>
        {!locked && (
          <Block title="Cancel" danger>
            <p className="text-sm text-muted-foreground">The link stops working. Nothing else changes.</p>
            <Button variant="outline" className="h-11 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => void cancel()}>
              Cancel invitation
            </Button>
          </Block>
        )}
      </div>
    </>
  );
}

function UserBody({ person, onClose, actor, activeSuperCount }: { person: AdminUser; onClose: () => void; actor: { id: string; isSuper: boolean }; activeSuperCount: number }) {
  const { data: jobs = [] } = useJobOptions();
  const { data: theirJobs, isLoading } = useUserJobs(person.id);
  const { data: log = [] } = useUserLog(person.id);
  const refresh = useRefreshUsers();
  const deactivate = useServerFn(deactivateUser);
  const reactivate = useServerFn(reactivateUser);
  const remove = useServerFn(deleteUser);
  const [fullName, setFullName] = useState(person.full_name ?? "");
  const [company, setCompany] = useState(person.company ?? "");
  const [level, setLevel] = useState<AppRole>(person.level);
  const [allJobs, setAllJobs] = useState(person.all_jobs);
  const [picks, setPicks] = useState<JobPick[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "status" | "delete">(null);
  const [confirm, setConfirm] = useState<null | "deactivate" | "delete">(null);
  const [typed, setTyped] = useState("");

  // Start from what they have now: exceptions always, and with selected jobs every job they are on.
  useEffect(() => {
    if (!theirJobs) return;
    setPicks(theirJobs.filter((j) => j.source === "job" || (!person.all_jobs && j.source === "level")).map((j) => ({ projectId: j.project_id, role: j.source === "job" ? j.role : null })));
  }, [theirJobs, person.all_jobs]);

  const edit = canAct(actor, person, "edit", activeSuperCount);
  const canEdit = edit.ok && person.status !== "deactivated";
  const isSelf = person.id === actor.id;
  // Jobs they hold that this admin cannot otherwise see still appear, so saving never drops them.
  const options: JobOption[] = [...jobs, ...(theirJobs ?? []).filter((t) => !jobs.some((j) => j.id === t.project_id)).map((t) => ({ id: t.project_id, name: t.name, archived_at: t.archived_at }))];
  const names = new Map(options.map((j) => [j.id, j.name]));
  const summary = accessSummary(level, allJobs, picks.map((p) => ({ name: names.get(p.projectId) ?? "a job", role: p.role })));
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const save = async () => {
    if (isSelf && level !== person.level && !window.confirm("You're changing your own level. You could lose access to this screen. Continue?")) return;
    setBusy("save");
    const { error } = await supabase.rpc("admin_save_user", {
      _user: person.id,
      _full_name: fullName,
      _company: company,
      _level: level,
      _all_jobs: allJobs,
      _jobs: picks.map((p) => ({ project_id: p.projectId, role: p.role })),
    });
    setBusy(null);
    if (error) return void toast.error(error.message);
    toast.success("Access saved");
    setDirty(false);
    refresh();
  };

  const setStatus = async (next: "deactivate" | "reactivate") => {
    setBusy("status");
    try {
      await (next === "deactivate" ? deactivate : reactivate)({ data: { userId: person.id } });
      toast.success(next === "deactivate" ? `${person.full_name || person.email} is deactivated and signed out` : `${person.full_name || person.email} can sign in again`);
      refresh();
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const doDelete = async () => {
    setBusy("delete");
    try {
      const r = await remove({ data: { userId: person.id, confirmName: typed } });
      if (r.ok) toast.success(`${person.full_name || person.email} was deleted`);
      else toast.error(r.error, { duration: 12000 });
      refresh();
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
      setConfirm(null);
      setTyped("");
    }
  };

  const deact = canAct(actor, person, "deactivate", activeSuperCount);
  const react = canAct(actor, person, "reactivate", activeSuperCount);
  const del = canAct(actor, person, "delete", activeSuperCount);
  const confirmName = person.full_name || person.email;

  return (
    <>
      <Header p={person} />
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {!edit.ok && <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{edit.why}.</p>}
        {person.status === "deactivated" && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            Deactivated. They can't sign in, and their access below is set aside until they are reactivated.
          </p>
        )}
        <Block title="Person">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ps-name">Full name</Label>
              <Input id="ps-name" className="h-11" disabled={!canEdit} value={fullName} onChange={(e) => change(setFullName)(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps-company">Company</Label>
              <Input id="ps-company" className="h-11" disabled={!canEdit} value={company} onChange={(e) => change(setCompany)(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Last sign-in: {person.last_sign_in_at ? when(person.last_sign_in_at) : "never"}
            {isSelf ? " (you)" : ""}
          </p>
        </Block>
        <Block title="Level">
          <LevelPicker value={level} onChange={change(setLevel)} actorIsSuper={actor.isSuper} disabled={!canEdit} />
        </Block>
        <Block title="Jobs">
          {isLoading ? <p className="text-sm text-muted-foreground">Loading jobs…</p> : <JobAccessPicker level={level} allJobs={allJobs} onAllJobs={change(setAllJobs)} picks={picks} onPicks={change(setPicks)} jobs={options} actorIsSuper={actor.isSuper} disabled={!canEdit} />}
        </Block>
        {canEdit && (
          <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{summary}</span>
            </p>
            <Button className="h-11" disabled={!dirty || busy !== null} onClick={() => void save()}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}

        <Block title="Sign-in">
          {person.status === "deactivated" ? (
            <>
              <p className="text-sm text-muted-foreground">Reactivating restores their sign-in and all the access shown above.</p>
              <Button className="h-11" disabled={!react.ok || busy !== null} onClick={() => void setStatus("reactivate")}>
                {busy === "status" ? "Reactivating…" : "Reactivate"}
              </Button>
              {!react.ok && <p className="text-xs text-muted-foreground">{react.why}</p>}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Deactivating signs them out everywhere and blocks sign-in. Their name stays on their work, and you can reactivate them at any time.</p>
              <Button variant="outline" className="h-11 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={!deact.ok || busy !== null} onClick={() => setConfirm("deactivate")}>
                Deactivate
              </Button>
              {!deact.ok && <p className="text-xs text-muted-foreground">{deact.why}</p>}
            </>
          )}
        </Block>

        {person.status === "deactivated" && (
          <Block title="Delete permanently" danger>
            <p className="text-sm text-muted-foreground">Removes the account for good. Only possible when their name is on nothing in BMD Projects.</p>
            <Button variant="destructive" className="h-11" disabled={!del.ok || busy !== null} onClick={() => setConfirm("delete")}>
              Delete permanently
            </Button>
            {!del.ok && <p className="text-xs text-muted-foreground">{del.why}.</p>}
          </Block>
        )}

        <Block title="Activity">
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {log.map((l, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {ACTIONS[l.action] ?? l.action}
                    {l.action === "saved" && typeof l.detail["level"] === "string" ? `: ${roleLabel(l.detail["level"])}${l.detail["all_jobs"] ? ", all jobs" : ""}` : ""}
                    <span className="text-muted-foreground"> by {l.actor_name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{when(l.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <AlertDialog open={confirm === "deactivate"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {confirmName}?</AlertDialogTitle>
            <AlertDialogDescription>They're signed out on every device and can't sign in. Their open invites are cancelled. Their name stays on their work, and Reactivate brings everything back.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep active</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void setStatus("deactivate")}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "delete"} onOpenChange={(o) => !o && (setConfirm(null), setTyped(""))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmName} permanently?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone. Type their name to confirm.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input className="h-11" autoFocus placeholder={confirmName} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type their name to confirm" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={typed.trim().toLowerCase() !== confirmName.trim().toLowerCase() || busy !== null}
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
            >
              {busy === "delete" ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Block({ title, danger, children }: { title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <section className={danger ? "space-y-3 rounded-lg border border-destructive/30 p-4" : "space-y-3"}>
      <h3 className={`text-xs font-semibold tracking-wide uppercase ${danger ? "text-destructive" : "text-muted-foreground"}`}>{title}</h3>
      {children}
    </section>
  );
}
