import { cn } from "@/lib/utils";

/** The bordered card every Settings → Integrations section sits in. */
export function SettingsBox({ children, className, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-card p-4 md:p-5", className)}
      {...rest}
    >
      {children}
    </section>
  );
}
