"use client";

import { useEffect, useState } from "react";

type Prefs = {
  dark: boolean;
  hc: boolean;
  textsize: "normal" | "large" | "xlarge";
  motion: "normal" | "reduced";
};

const KEY = "relaygoal-a11y";
const DEFAULTS: Prefs = { dark: false, hc: false, textsize: "normal", motion: "normal" };

function apply(p: Prefs) {
  const el = document.documentElement;
  el.classList.toggle("dark", p.dark);
  el.classList.toggle("hc", p.hc);
  if (p.textsize === "normal") el.removeAttribute("data-textsize");
  else el.setAttribute("data-textsize", p.textsize);
  if (p.motion === "normal") el.removeAttribute("data-motion");
  else el.setAttribute("data-motion", "reduced");
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode / storage blocked — controls still work for this session */
  }
}

const SIZE_LABEL: Record<Prefs["textsize"], string> = { normal: "Larger text", large: "Text: large", xlarge: "Text: largest" };

// Display preferences. Deliberately compact: these are utility controls for the
// reader, not a feature row, so they must not compete with the brand or the task.
export function A11yControls() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  // Sync initial state from whatever the pre-paint init script already applied.
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
      setPrefs({ ...DEFAULTS, ...stored });
    } catch {
      /* ignore */
    }
  }, []);

  function update(patch: Partial<Prefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      apply(next);
      return next;
    });
  }

  const sizes: Prefs["textsize"][] = ["normal", "large", "xlarge"];

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1" role="group" aria-label="Display settings">
      <span className="sr-only">Display</span>
      <Toggle pressed={prefs.dark} onClick={() => update({ dark: !prefs.dark })} label={prefs.dark ? "Switch to light theme" : "Switch to dark theme"}>
        {prefs.dark ? "Light" : "Dark"}
      </Toggle>
      <Toggle pressed={prefs.hc} onClick={() => update({ hc: !prefs.hc })} label="High contrast">
        Contrast
      </Toggle>
      <Toggle
        pressed={prefs.textsize !== "normal"}
        label={`Text size: ${prefs.textsize}. Press to change.`}
        onClick={() => {
          const i = sizes.indexOf(prefs.textsize);
          const nextSize = sizes[(i + 1) % sizes.length]!;
          update({ textsize: nextSize });
        }}
      >
        {SIZE_LABEL[prefs.textsize]}
      </Toggle>
      <Toggle
        pressed={prefs.motion === "reduced"}
        label="Reduce motion"
        onClick={() => update({ motion: prefs.motion === "reduced" ? "normal" : "reduced" })}
      >
        Motion
      </Toggle>
    </div>
  );
}

function Toggle({
  pressed,
  onClick,
  label,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`min-h-8 rounded-md px-2.5 py-1 text-sm font-semibold transition-colors ${
        pressed ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
