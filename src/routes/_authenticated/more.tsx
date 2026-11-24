import { roleLabel } from "@/lib/roles";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Plus } from "lucide-react";
import { PageHeader, useNavItems } from "@/components/AppShell";
import { ChangePassword } from "@/components/ChangePassword";
import { YourCalendarCard } from "@/components/calendar/YourCalendarCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useProject } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/more")({
  // `calendar` and `message` are set when Microsoft sends the person back after "Connect my Outlook calendar".
  validateSearch: (s: Record<string, unknown>): { calendar?: string | undefined; message?: string | undefined } => ({
    ...(typeof s["calendar"] === "string" ? { calendar: s["calendar"] } : {}),
    ...(typeof s["message"] === "string" ? { message: s["message"] } : {}),
  }),
  component: MorePage,
});

function MorePage() {
  const nav = useNavItems();
  const { user, roles, canCreateJobs } = useAuth();
  const { data: project } = useProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  };

  return (
    <div>
      <PageHeader title="More" subtitle={project?.name ?? undefined} />
      <div className="space-y-6 p-4 md:p-6">
        {canCreateJobs && (
          <Link
            to="/new-job"
            className="flex min-h-[60px] items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground"
          >
            <Plus className="h-5 w-5" /> Add new job
          </Link>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {nav.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              {...(item.search ? { search: item.search } : {})}
              {...(item.params ? { params: item.params } : {})}
              className="flex min-h-[60px] items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium"
            >
              <item.icon className="h-5 w-5 text-primary" />
              {item.label}
            </Link>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">{user?.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Access: {roles.map(roleLabel).join(", ") || "no role assigned yet"}
          </p>
          <Button variant="outline" className="mt-4 h-11" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
        <YourCalendarCard result={search.calendar} message={search.message} />
        <ChangePassword email={user?.email} />
      </div>
    </div>
  );
}
