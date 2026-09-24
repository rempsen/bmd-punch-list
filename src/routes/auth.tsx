import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · BMD Deficiency Tracker" },
      {
        name: "description",
        content:
          "Sign in to the BMD Materials deficiency tracker for flooring and tile punch list work.",
      },
      { property: "og:title", content: "Sign in · BMD Deficiency Tracker" },
      {
        property: "og:description",
        content: "Field and office access to BMD Materials punch list tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { next?: string | undefined; invite?: string | undefined; email?: string | undefined } => ({
    invite: typeof s["invite"] === "string" ? s["invite"] : undefined,
    email: typeof s["email"] === "string" ? s["email"] : undefined,
    next: typeof s["next"] === "string" && s["next"].startsWith("/") && !s["next"].startsWith("//") ? s["next"] : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const { next, invite, email: invitedEmail } = Route.useSearch();
  const go = () => (next ? window.location.assign(next) : void navigate({ to: "/floors" }));
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(invite ? "signup" : "signin");
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        go();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + (next ?? ""),
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        if (data.session) {
          go();
        } else {
          toast.success("Check your email to confirm your account, then sign in.");
          setMode("signin");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-logo-bg px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-border bg-logo-bg p-6 shadow-lg">
        <img src="/bmd-logo.png" alt="BMD Materials" className="mx-auto w-[220px]" />
        <h1 className="mt-2 text-center text-lg font-semibold tracking-tight">Deficiency Tracker</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin" ? "Sign in to continue." : "Create your account."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-12"
                autoComplete="name"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12"
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </div>
          <Button type="submit" disabled={busy} className="h-12 w-full text-base">
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-4 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          You'll see the jobs your BMD admin invited you to. If you don't see a job, ask your BMD
          admin to add you in Settings → Users.
        </p>
      </div>
    </div>
  );
}
