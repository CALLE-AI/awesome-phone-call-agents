"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { DataSource } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspaceDataSource } from "./DataSourceProvider";
import { useTheme, type Theme } from "./ThemeProvider";

const COMING_SOON = [
  { label: "Notifications", detail: "Email and in-app alerts for hot leads, missed pickups, and weekly summaries." },
  { label: "Team & members", detail: "Invite reps, assign roles, and control who can dispatch CALL-E." },
  { label: "Billing & plan", detail: "Seat counts, usage, and invoices for this workspace." },
  { label: "Security", detail: "SSO, session timeout, and audit log export." },
  { label: "Language & region", detail: "Console locale, default timezone, and number formatting." },
  { label: "Integrations", detail: "CRM bulk sync, Slack alerts, and calendar booking." }
];

export function SettingsPanel() {
  const { theme, setTheme } = useTheme();
  const { dataSource, saving, error, setDataSource } = useWorkspaceDataSource();

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card className="[--card-spacing:1.5rem]">
        <CardHeader className="gap-2">
          <CardTitle>Console data source</CardTitle>
          <CardDescription>
            Mock overlay fills Analytics charts plus the Leads inbox, lead detail, and call dossiers without writing
            visitors, events, or calls into SQLite. Harbor ingest still lands in the live database. Switching back to
            live hides the fixture queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={dataSource}
            disabled={saving}
            onValueChange={(next) => {
              if (next === "live" || next === "mock") void setDataSource(next);
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            {(
              [
                { id: "live", label: "Live database", detail: "Empty until Harbor traffic arrives" },
                { id: "mock", label: "Mock overlay", detail: "Sample analytics and inbound queue" }
              ] as const
            ).map((option) => {
              const active = dataSource === option.id;
              return (
                <label
                  key={option.id}
                  htmlFor={`source-${option.id}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                    active ? "border-primary bg-accent" : "border-border hover:bg-muted/60"
                  )}
                >
                  <RadioGroupItem id={`source-${option.id}`} value={option.id} className="mt-0.5" />
                  <div>
                    <div className="font-medium">{option.label}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{option.detail}</div>
                  </div>
                </label>
              );
            })}
          </RadioGroup>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {saving ? <p className="text-sm text-muted-foreground">Saving…</p> : null}
        </CardContent>
      </Card>

      <Card className="[--card-spacing:1.5rem]">
        <CardHeader className="gap-2">
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Light or dark console. Harbor demo pages keep their own product theme.</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={theme}
            onValueChange={(next) => {
              if (next === "light" || next === "dark" || next === "system") setTheme(next);
            }}
            className="grid gap-3 sm:grid-cols-3"
          >
            {(
              [
                { id: "light" as Theme, label: "Light", detail: "Cream Sundials console" },
                { id: "dark" as Theme, label: "Dark", detail: "Warm ink, same orange" },
                { id: "system" as Theme, label: "System", detail: "Follow the OS setting" }
              ] as const
            ).map((option) => {
              const active = theme === option.id;
              return (
                <label
                  key={option.id}
                  htmlFor={`theme-${option.id}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                    active ? "border-primary bg-accent" : "border-border hover:bg-muted/60"
                  )}
                >
                  <RadioGroupItem id={`theme-${option.id}`} value={option.id} className="mt-0.5" />
                  <div>
                    <div className="font-medium">{option.label}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{option.detail}</div>
                  </div>
                </label>
              );
            })}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card className="[--card-spacing:1.5rem]">
        <CardHeader className="gap-2">
          <CardTitle>Workspace</CardTitle>
          <CardDescription>Typical workspace controls. Not wired in this proof of concept.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {COMING_SOON.map((item) => (
            <div key={item.label} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="font-medium">{item.label}</div>
                <div className="mt-1 text-sm text-muted-foreground">{item.detail}</div>
              </div>
              <Badge variant="secondary" className="shrink-0">
                Coming soon
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
