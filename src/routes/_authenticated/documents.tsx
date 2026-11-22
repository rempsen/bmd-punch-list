import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";
import { DocumentsTab } from "@/components/projects/DocumentsTab";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({ meta: [{ title: "Documents — BMD Projects" }] }),
  component: DocumentsPage,
});

/** The current job's documents, for site staff who work from the job rather than the pipeline. */
function DocumentsPage() {
  const { currentJob, can } = useAuth();
  if (!currentJob) return null;
  return (
    <div>
      <PageHeader title="Documents" subtitle={currentJob.name} />
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        {can("view_documents") ? <DocumentsTab projectId={currentJob.id} /> : <p className="text-sm text-muted-foreground">You don't have access to documents.</p>}
      </div>
    </div>
  );
}
