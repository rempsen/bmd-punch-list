import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { MIN_PASSWORD, passwordProblem } from "@/lib/password";

/** Lets the signed-in person set their own password. Nobody else ever sees it. */
export function ChangePassword({ email }: { email: string | null | undefined }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const problem = passwordProblem(pw, again);
    if (problem) return void toast.error(problem);
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return void toast.error(`The password was not changed: ${error.message}`);
    setPw("");
    setAgain("");
    toast.success("Password changed. Use the new one next time you sign in.");
  };
  return (
    <section className="max-w-md rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">Change your password</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        For {email ?? "your account"}. Use at least {MIN_PASSWORD} characters. If you were given a temporary password, change it here.
      </p>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" autoComplete="new-password" className="h-11" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="new-password-again">New password again</Label>
          <Input id="new-password-again" type="password" autoComplete="new-password" className="h-11" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        <Button type="submit" className="h-11" disabled={busy || !pw || !again}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
    </section>
  );
}
