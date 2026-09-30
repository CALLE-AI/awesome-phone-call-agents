"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PublicAccount } from "@/lib/accounts";

function snippets(accountId: string, sdkKey: string) {
  return {
    html: `<script
  src="https://cdn.sundials.io/v1/sundials.js"
  data-sundials-key="${sdkKey}"
  data-account-id="${accountId}"
  defer>
</script>`,
    react: `import { Sundials } from "@sundials/sdk";

<Sundials
  apiKey="${sdkKey}"
  accountId="${accountId}"
/>`
  };
}

export function ApiKeysPanel({ account: initial }: { account: PublicAccount }) {
  const [account, setAccount] = useState(initial);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setError(null);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1500);
    } catch {
      setError("Could not copy to clipboard");
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sundials/console/keys", { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
        account?: PublicAccount;
        sdkKey?: string;
      } | null;
      if (!res.ok || !data?.success || !data.account) {
        setError(data?.message || "Could not generate a key.");
        return;
      }
      setAccount(data.account);
    } catch {
      setError("Could not generate a key.");
    } finally {
      setBusy(false);
    }
  };

  const sdkKey = account.sdkKey || "";
  const snips = sdkKey ? snippets(account.id, sdkKey) : null;

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <Badge variant="secondary">Publishable</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Generate a server-issued SDK key for this account, then paste it into your own site via{" "}
          <code className="text-xs">apiKey</code> or <code className="text-xs">data-sundials-key</code>{" "}
          (see snippets below). Harbor <code className="text-xs">/demo</code> is a bundled demo only — it
          auto-reads Harbor&apos;s key from SQLite after you generate it so you do not wire credentials by
          hand. Dispatch, events, and stop look the key up in the local database.
        </p>
      </div>

      <Card className="[--card-spacing:1.5rem]">
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium">Public SDK key</div>
            {sdkKey ? (
              <div className="flex gap-2">
                <Input readOnly value={sdkKey} className="font-mono" aria-label="Public SDK key" />
                <Button type="button" variant="outline" onClick={() => void copy(sdkKey, "key")}>
                  {copied === "key" ? "Copied" : "Copy"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No key yet. Generate one to connect the SDK.</p>
            )}
            <Button type="button" onClick={() => void generate()} disabled={busy}>
              {busy ? "Generating…" : sdkKey ? "Regenerate key" : "Generate key"}
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Account ID</div>
            <div className="flex gap-2">
              <Input readOnly value={account.id} className="font-mono" aria-label="Account ID" />
              <Button type="button" variant="outline" onClick={() => void copy(account.id, "account")}>
                {copied === "account" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          {snips ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Quick integration snippet</div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      HTML / CDN
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void copy(snips.html, "html")}>
                      {copied === "html" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed">
                    {snips.html}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      React / Next.js
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void copy(snips.react, "react")}>
                      {copied === "react" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed">
                    {snips.react}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
