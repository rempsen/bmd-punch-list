import { useEffect } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { resolveHome, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "BMD Projects" },
      {
        name: "description",
        content: "Punch list and deficiency tracking for BMD Materials flooring and tile jobs.",
      },
      { property: "og:title", content: "BMD Projects" },
      {
        property: "og:description",
        content: "Capture, track and close flooring and tile deficiencies from the field.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: Landing,
});

function Landing() {
  const { loading, jobsLoaded, currentJob, role, projectId } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading || !jobsLoaded) return;
    if (!currentJob) return void navigate({ to: "/jobs", replace: true });
    void resolveHome(role, projectId).then((to) => navigate({ to, replace: true }));
  }, [loading, jobsLoaded, currentJob, role, projectId, navigate]);
  return null;
}
