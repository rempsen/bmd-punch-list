import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AssignOption } from "@/lib/assign";

export function AssignFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: AssignOption[];
  onChange: (v: string) => void;
}) {
  const groups: ("" | "People" | "Trades")[] = ["", "People", "Trades"];
  return (
    <Select value={options.some((o) => o.value === value) ? value : "all"} onValueChange={onChange}>
      <SelectTrigger className="h-11 w-full sm:w-52">
        <span className="mr-1 text-muted-foreground">Assigned:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map((g) => {
          const opts = options.filter((o) => o.group === g);
          if (opts.length === 0) return null;
          return (
            <SelectGroup key={g || "base"}>
              {g && <SelectLabel>{g}</SelectLabel>}
              {opts.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}

