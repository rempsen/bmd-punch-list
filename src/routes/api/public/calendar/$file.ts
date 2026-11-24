import { createFileRoute } from "@tanstack/react-router";

/**
 * A person's calendar link: /api/public/calendar/<token>.ics. Outlook, Google Calendar and Apple Calendar read it with no
 * sign-in, so the token is the only key. An unknown, replaced or turned-off token gets a bare 404.
 */
export const Route = createFileRoute("/api/public/calendar/$file")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { feedHttp, tokenFromFile } = await import("@/lib/calendar/feed");
        const reply = (r: ReturnType<typeof feedHttp>) => new Response(r.body, { status: r.status, headers: r.headers });
        const token = tokenFromFile(params.file);
        if (!token) return reply(feedHttp({ status: 404 }));
        try {
          const { readFeed } = await import("@/lib/calendar/calendar.server");
          return reply(feedHttp(await readFeed(token, request.url)));
        } catch {
          return reply(feedHttp({ status: 404 }));
        }
      },
    },
  },
});
