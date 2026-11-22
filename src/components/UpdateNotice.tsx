import { useEffect, useState } from "react";
import { isNewerBuild } from "@/lib/version";

/** Tells someone with an old tab open that a newer version has been published, and offers to reload. */
export function UpdateNotice() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const loaded = document.documentElement.outerHTML;
    let last = 0;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible" || Date.now() - last < 60_000) return;
      last = Date.now();
      try {
        const res = await fetch("/auth", { cache: "no-store", credentials: "omit" });
        if (res.ok && isNewerBuild(loaded, await res.text())) {
          stopped = true;
          setStale(true);
        }
      } catch {
        /* offline or blocked: try again later */
      }
    };
    const timer = setInterval(() => void check(), 5 * 60_000);
    const onShow = () => void check();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    void check();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      <span>A newer version of BMD Projects has been published. This tab is still showing the old one.</span>
      <button type="button" onClick={() => window.location.reload()} className="min-h-9 rounded-md bg-primary px-4 font-medium text-primary-foreground">
        Reload now
      </button>
    </div>
  );
}
