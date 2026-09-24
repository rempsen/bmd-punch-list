import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; group?: string };

export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  invalid,
  onCreate,
  createLabel = "Add",
}: {
  id?: string;
  value: string | null;
  onChange: (v: string) => void;
  options: SearchOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  onCreate?: ((text: string) => unknown) | undefined;
  createLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  const exact = options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-invalid={invalid}
          className={cn(
            "flex h-11 w-full items-center justify-between rounded-md border bg-background px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
            invalid ? "border-destructive" : "border-input",
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[240px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Type to search…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g} heading={g || undefined}>
                {options.filter((o) => (o.group ?? "") === g).map((o) => (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.value}`}
                    onSelect={() => { onChange(o.value); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", o.value === value ? "opacity-100" : "opacity-0")} />
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {onCreate && query.trim() && !exact && (
              <CommandGroup>
                <CommandItem
                  value={`__create ${query}`}
                  onSelect={async () => { await onCreate(query.trim()); setOpen(false); setQuery(""); }}
                >
                  <Plus className="mr-2 h-4 w-4" /> {createLabel} "{query.trim()}"
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
