"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HARBOR_ACCOUNT_ID, HARBOR_PUBLIC_SDK_KEY } from "@/lib/sdk/public-key";

const HTML_SNIPPET = `<script
  src="https://cdn.sundials.io/v1/sundials.js"
  data-sundials-key="${HARBOR_PUBLIC_SDK_KEY}"
  data-account-id="${HARBOR_ACCOUNT_ID}"
  defer>
</script>`;

const REACT_SNIPPET = `import { Sundials } from "@sundials/sdk";

<Sundials
  apiKey="${HARBOR_PUBLIC_SDK_KEY}"
  accountId="${HARBOR_ACCOUNT_ID}"
/>`;

export function ApiKeysPanel({ geminiConfigured: _geminiConfigured }: { geminiConfigured: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <Badge variant="secondary">Mock</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Authenticate client-side events and connect inbound calls. Discovery goals on the Brain tab apply
          to every call dispatched with this key.
        </p>
      </div>

      <Card className="[--card-spacing:1.5rem]">
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium">Public SDK key</div>
            <div className="flex gap-2">
              <Input readOnly value={HARBOR_PUBLIC_SDK_KEY} className="font-mono" aria-label="Public SDK key" />
              <Button type="button" variant="outline" onClick={() => void copy(HARBOR_PUBLIC_SDK_KEY, "key")}>
                {copied === "key" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Account ID</div>
            <div className="flex gap-2">
              <Input readOnly value={HARBOR_ACCOUNT_ID} className="font-mono" aria-label="Account ID" />
              <Button type="button" variant="outline" onClick={() => void copy(HARBOR_ACCOUNT_ID, "account")}>
                {copied === "account" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Quick integration snippet</div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">HTML / CDN</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void copy(HTML_SNIPPET, "html")}>
                    {copied === "html" ? "Copied" : "Copy"}
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed">
                  {HTML_SNIPPET}
                </pre>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">React / Next.js</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void copy(REACT_SNIPPET, "react")}>
                    {copied === "react" ? "Copied" : "Copy"}
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed">
                  {REACT_SNIPPET}
                </pre>
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
