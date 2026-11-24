import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AppRole } from "@/lib/roles";
import { accessSummary, validateInvite, type JobPick } from "@/lib/users/logic";
import { inviteUser } from "@/lib/users/users.functions";
import { errText, useJobOptions, useRefreshUsers } from "./data";
import { JobAccessPicker } from "./JobAccessPicker";
import { LevelPicker } from "./LevelPicker";

/** Add someone new: who they are, their company level, the jobs they reach, and the invite email. */
export function AddUserSheet({ open, onOpenChange, actorIsSuper }: { open: boolean; onOpenChange: (o: boolean) => void; actorIsSuper: boolean }) {
  const { data: jobs = [] } = useJobOptions();
  const refresh = useRefreshUsers();
  const invite = useServerFn(inviteUser);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [level, setLevel] = useState<AppRole>("bmd_field");
  const [allJobs, setAllJobs] = useState(false);
  const [picks, setPicks] = useState<JobPick[]>([]);
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setEmail("");
    setFullName("");
    setCompany("");
    setLevel("bmd_field");
    setAllJobs(false);
    setPicks([]);
    setSend(true);
  };
  const names = new Map(jobs.map((j) => [j.id, j.name]));
  const who = fullName.trim() || email.trim() || "This person";
  const summary = accessSummary(level, allJobs, picks.map((p) => ({ name: names.get(p.projectId) ?? "a job", role: p.role })));
  const check = validateInvite({ email, fullName, company, level, allJobs, jobs: picks });

  const submit = async () => {
    if (!check.ok) return void toast.error(check.why);
    setBusy(true);
    try {
      const r = await invite({ data: { ...check.value, company: check.value.company ?? "", send } });
      if (!send) toast.success(`${who} added. Send the invite from their page when you're ready.`);
      else if (r.email?.ok) toast.success(`Invitation sent to ${check.value.email}`);
      else toast.error(`${who} was added, but the email was not sent: ${r.email && !r.email.ok ? r.email.error : "unknown error"}. Use Resend or Copy link on their page.`, { duration: 12000 });
      refresh();
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle>Add user</SheetTitle>
          <SheetDescription>They get an email to create their account. Their access starts when they sign up.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Person</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="au-email">Email</Label>
                <Input id="au-email" className="h-11" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="au-name">Full name</Label>
                <Input id="au-name" className="h-11" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="au-company">Company</Label>
                <Input id="au-company" className="h-11" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={level === "trade" ? "e.g. ABC Tile" : "Optional"} />
              </div>
            </div>
          </section>
          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Level</h3>
            <LevelPicker value={level} onChange={setLevel} actorIsSuper={actorIsSuper} />
            <p className="text-xs text-muted-foreground">What each level can do is set under Roles.</p>
          </section>
          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Jobs</h3>
            <JobAccessPicker level={level} allJobs={allJobs} onAllJobs={setAllJobs} picks={picks} onPicks={setPicks} jobs={jobs} actorIsSuper={actorIsSuper} />
          </section>
        </div>
        <SheetFooter className="flex-col gap-3 border-t border-border bg-muted/30 p-5 sm:flex-col">
          <p className="text-sm">
            <span className="font-medium">{who}</span> will be a <span className="font-medium">{summary}</span>.
          </p>
          {!check.ok && (email || picks.length > 0) && <p className="text-sm text-destructive">{check.why}</p>}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={send} onCheckedChange={(v) => setSend(v === true)} /> Email the invitation now
          </label>
          <div className="flex gap-2">
            <Button className="h-11 flex-1" disabled={busy || !check.ok} onClick={() => void submit()}>
              {busy ? "Adding…" : send ? "Add and send invite" : "Add user"}
            </Button>
            <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
