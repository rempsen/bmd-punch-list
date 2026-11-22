/**
 * A tab left open keeps running the version it loaded, even after a newer one is published.
 * The build is identified by the app's entry file, whose name changes with every publish.
 */
export function entryAsset(html: string): string | null {
  return html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;
}

/** True only when both pages name an entry file and the names differ. */
export function isNewerBuild(loadedHtml: string, serverHtml: string): boolean {
  const mine = entryAsset(loadedHtml);
  const theirs = entryAsset(serverHtml);
  return !!mine && !!theirs && mine !== theirs;
}
