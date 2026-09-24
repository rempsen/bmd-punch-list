import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SCOPES, type Contact } from "@/lib/job-wizard";

export function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

export type DetailsValue = {
  name: string;
  street: string;
  city: string;
  province: string;
  postal_code: string;
  po_number: string;
  start_date: string;
  target_date: string;
  notes: string;
};

export function DetailsFields({ value, onChange }: { value: DetailsValue; onChange: (p: Partial<DetailsValue>) => void }) {
  const inp = (k: keyof DetailsValue, type = "text", placeholder?: string) => (
    <Input className="h-11" type={type} placeholder={placeholder} value={value[k]} onChange={(e) => onChange({ [k]: e.target.value })} />
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Job name" required>{inp("name", "text", "e.g. Hyatt Centric 325 Broadway")}</Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Street">{inp("street", "text", "325 Broadway")}</Field>
      </div>
      <Field label="City">{inp("city", "text", "Winnipeg")}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Province">{inp("province", "text", "MB")}</Field>
        <Field label="Postal code">{inp("postal_code", "text", "R3C 0R9")}</Field>
      </div>
      <Field label="BMD job / PO number">{inp("po_number")}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">{inp("start_date", "date")}</Field>
        <Field label="Target completion">{inp("target_date", "date")}</Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Notes">
          <Textarea rows={3} value={value.notes} onChange={(e) => onChange({ notes: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

export function ContactFields({ value, onChange }: { value: Contact; onChange: (p: Partial<Contact>) => void }) {
  const inp = (k: keyof Contact, type = "text", placeholder?: string) => (
    <Input className="h-11" type={type} placeholder={placeholder} value={value[k]} onChange={(e) => onChange({ [k]: e.target.value } as Partial<Contact>)} />
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Contact name">{inp("name")}</Field>
      <Field label="Role / title">{inp("title", "text", "e.g. Project manager")}</Field>
      <Field label="Email">{inp("email", "email")}</Field>
      <Field label="Company">{inp("company")}</Field>
      <Field label="Mobile phone">{inp("phone_mobile", "tel")}</Field>
      <Field label="Office phone">{inp("phone_office", "tel")}</Field>
    </div>
  );
}

export function ScopePicker({
  value,
  other,
  onChange,
  onOther,
}: {
  value: string[];
  other: string;
  onChange: (v: string[]) => void;
  onOther: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SCOPES.map((s) => {
          const on = value.includes(s.key);
          return (
            <label
              key={s.key}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <Checkbox
                checked={on}
                onCheckedChange={(c) => onChange(c ? [...value, s.key] : value.filter((x) => x !== s.key))}
              />
              {s.label}
            </label>
          );
        })}
      </div>
      {value.includes("other") && (
        <Input className="h-11" placeholder="Describe the other scope" value={other} onChange={(e) => onOther(e.target.value)} />
      )}
    </div>
  );
}
