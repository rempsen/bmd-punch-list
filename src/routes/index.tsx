import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "BMD Deficiency Tracker" },
      {
        name: "description",
        content:
          "Punch list and deficiency tracking for BMD Materials flooring and tile work at the Hyatt Centric.",
      },
      { property: "og:title", content: "BMD Deficiency Tracker" },
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
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const list = (roles ?? []).map((r) => r.role);
    if (list.includes("client")) throw redirect({ to: "/decisions" });
    if (list.includes("bmd_field") || list.includes("bmd_admin")) throw redirect({ to: "/capture" });
    throw redirect({ to: "/floors" });
  },
  component: () => null,
});
