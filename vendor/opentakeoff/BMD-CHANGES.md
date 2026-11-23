# Changes made by BMD Materials

This folder holds the `web/` application of OpenTakeoff at tag `apache-2.0-final`
(commit `84c7f48e`, 10 October 2026), licensed under the Apache License 2.0.
See `LICENSE`, `NOTICE` and `THIRD-PARTY-NOTICES.md`. No code from later
OpenTakeoff commits, which are under AGPL-3.0, is included.

Left out of this copy: `web/test/`, `web/bench/`, `web/review/` (the upstream test
fixtures and benchmarks; about 10 MB that the BMD build does not use).

Every change is marked in the source with a `// BMD change:` comment.

| File | Change | Why |
|---|---|---|
| `web/vite.config.js` | `base` set to `/takeoff/`; output folder set to the BMD app's `public/takeoff` | The workspace is served from inside the BMD Projects site |
| `web/index.html` | Replaced. Removed the upstream site's search and social tags, the Cloudflare Web Analytics beacon, the Netlify sign-up form and links to the upstream site's privacy, terms and llms.txt pages; added `noindex` and `no-referrer`; title set to "Takeoff · BMD Projects" | A private tool: no visitor analytics or third-party form posts, and not for search engines |
| `web/public/` | Removed `_headers`, `googlec4381fb3b0fbe628.html`, `legal.css`, `llms.txt`, `og-card.png`, `privacy/`, `terms/`, `robots.txt`, `sitemap.xml` | Upstream's own public-website files |
