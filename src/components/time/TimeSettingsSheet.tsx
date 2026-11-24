import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { errText } from "@/lib/platform/db";
import { saveTimeSettings, useRefreshTime, useTimeSettings } from "@/lib/time/data";

const INCREMENTS = [1, 5, 6, 10, 15, 30];

/** Company settings for the time clock: the rounding increment and when the overtime heads-up shows. */
export function TimeSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useTimeSettings();
  const refresh = useRefreshTime();
  const [rounding, setRounding] = useState(15);
  const [daily, setDaily] = useState("8");
  const [weekly, setWeekly] = useState("40");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !settings.data) return;
    setRounding(settings.data.rounding_minutes);
    setDaily(String(settings.data.overtime_daily_minutes / 60));
    setWeekly(String(settings.data.overtime_weekly_minutes / 60));
  }, [open, settings.data]);
  const save = async () => {
    const d = Number(daily), w = Number(weekly);
    if (!(d > 0 && d <= 24) || !(w > 0 && w <= 168)) return void toast.error("Enter the overtime hours as numbers, such as 8 and 40.");
    setBusy(true);
    try {
      await saveTimeSettings({ rounding_minutes: rounding, overtime_daily_minutes: Math.round(d * 60), overtime_weekly_minutes: Math.round(w * 60) });
      await refresh();
      toast.success("Time clock settings saved");
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Time clock settings</SheetTitle>
          <SheetDescription>These apply to everyone in the company.</SheetDescription>
        </SheetHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ts-rounding">Round paid time to the nearest</Label>
          <select id="ts-rounding" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={rounding} onChange={(e) => setRounding(Number(e.target.value))}>
            {INCREMENTS.map((m) => (
              <option key={m} value={m}>
                {m === 1 ? "1 minute (no rounding)" : `${m} minutes`}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Used from now on, when someone clocks out or an entry is adjusted. Entries already closed keep their hours.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ts-daily">Overtime after, a day</Label>
            <Input id="ts-daily" className="h-11" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ts-weekly">Overtime after, a week</Label>
            <Input id="ts-weekly" className="h-11" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value)} />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">In hours. Going over only shows a heads-up on the timesheet. It never changes hours or pay.</p>
        </div>
        <Button className="h-11" disabled={busy || !settings.data} onClick={() => void save()}>
          Save
        </Button>
      </SheetContent>
    </Sheet>
  );
}
