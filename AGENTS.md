<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## ArrivePing integration layout
- `src/lib/arriveping/`: `core.ts` (pure: paths, key lookup, mapping), `client.server.ts` (HTTP client), `outbox.server.ts` (sync queue), `push.ts` (pure push logic), `arriveping.functions.ts` (server functions called by the UI).
- `src/lib/visits/`: `logic.ts` (pure visit rules) and `data.ts` (queries).
- Inbound events: `src/routes/api/public/arriveping/webhook.ts`, authenticated by `X-Webhook-Secret`.
- The API key never reaches the browser; all ArrivePing calls go through server functions.
