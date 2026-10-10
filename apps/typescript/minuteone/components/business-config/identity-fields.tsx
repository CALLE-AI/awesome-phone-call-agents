import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface Identity {
  name: string;
  openingLine: string;
}

interface IdentityFieldsProps {
  value: Identity;
  onChange: (value: Identity) => void;
}

/** Business name + opening line — no Card wrapper, callers supply their own chrome. */
export function IdentityFields({ value, onChange }: IdentityFieldsProps) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="business-name">Business name</Label>
        <Input
          id="business-name"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="Riverside Home Services"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="opening-line">Opening line</Label>
        <Textarea
          id="opening-line"
          value={value.openingLine}
          onChange={(e) => onChange({ ...value, openingLine: e.target.value })}
          placeholder='Hi, this is Ava calling from Riverside Home Services about the quote request you just submitted — do you have a minute?'
        />
      </div>
    </div>
  );
}
