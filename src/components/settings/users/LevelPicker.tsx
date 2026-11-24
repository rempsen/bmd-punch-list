import { Check } from "lucide-react";
import { ROLES, type AppRole } from "@/lib/roles";
import { levelsFor } from "@/lib/users/logic";
import { cn } from "@/lib/utils";

/** The company level as cards, each with what it allows in one line. */
export function LevelPicker({ value, onChange, actorIsSuper, disabled }: { value: AppRole; onChange: (v: AppRole) => void; actorIsSuper: boolean; disabled?: boolean }) {
  const levels = levelsFor(actorIsSuper);
  return (
    <div role="radiogroup" aria-label="Level" className="grid gap-2 sm:grid-cols-2">
      {levels.map((l) => {
        const r = ROLES.find((x) => x.value === l)!;
        const on = value === l;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(l)}
            className={cn(
              "flex min-h-16 items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60",
              on ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60",
            )}
          >
            <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
              {on && <Check className="h-3 w-3" aria-hidden />}
            </span>
            <span>
              <span className="block text-sm font-medium">{r.label}</span>
              <span className="block text-xs text-muted-foreground">{r.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
