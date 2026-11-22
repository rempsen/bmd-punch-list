import { createFileRoute, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef } from "react";
import { PublicQuote } from "@/components/quotes/PublicQuote";
import { acceptPublicQuote, getPublicQuote, savePublicSelections } from "@/lib/quotes/public.functions";

/** A client's private quote page. No sign-in; the link's secret is the key. Search engines are told to stay away. */
export const Route = createFileRoute("/q/$token")({
  loader: async ({ params }) => {
    const view = /^[A-Za-z0-9_-]{43}$/.test(params.token) ? await getPublicQuote({ data: { token: params.token } }) : null;
    if (!view) throw notFound();
    return view;
  },
  headers: () => ({ "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" }),
  head: () => ({ meta: [{ title: "Quotation · BMD Materials" }, { name: "robots", content: "noindex, nofollow, noarchive" }, { name: "referrer", content: "no-referrer" }] }),
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">This link is not available</h1>
      <p className="mt-2 text-muted-foreground">The link may have been replaced or withdrawn. Please contact BMD Materials at office@bmdmaterials.com.</p>
    </main>
  ),
  component: Page,
});

function Page() {
  const view = Route.useLoaderData();
  const { token } = Route.useParams();
  const save = useServerFn(savePublicSelections);
  const accept = useServerFn(acceptPublicQuote);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <PublicQuote
      view={view}
      onSave={(choices) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void save({ data: { token, choices } }).catch(() => undefined), 600);
      }}
      onAccept={(input) => accept({ data: { token, ...input } })}
    />
  );
}
