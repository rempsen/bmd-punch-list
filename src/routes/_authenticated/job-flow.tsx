import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/job-flow")({
  head: () => ({
    meta: [
      { title: "Job Flow — BMD Projects" },
      { name: "description", content: "Job Flow for the current BMD Materials job." },
      { property: "og:title", content: "Job Flow — BMD Projects" },
      { property: "og:description", content: "Job Flow for the current BMD Materials job." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JobFlowPage,
});

function JobFlowPage() {
  return <PageHeader title="Job Flow" subtitle="Coming soon" />;
}
