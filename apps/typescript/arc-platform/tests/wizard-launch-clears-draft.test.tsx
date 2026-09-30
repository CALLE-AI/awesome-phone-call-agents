import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { WizardProvider, useWizard, reducer } from "@/app/campaigns/create/_components/WizardContext";
import type { WizardState } from "@/app/campaigns/create/_components/WizardContext";

/**
 * Launching a campaign used to leave the brief sitting in localStorage.
 * Nothing removed it but the Discard button, and two bugs came out of that.
 *
 * The dashboard kept offering "You have an unfinished brief - you stopped at
 * Review" next to the campaign that brief had already become. Both statements
 * were true from their own source and neither knew the other existed.
 *
 * Worse: Resume reopened the finished brief, so Launch POSTed a SECOND
 * campaign. That is how two identical campaigns were created a minute apart
 * on 5 September, both ACTIVE.
 *
 * The key is deleted by the persist effect rather than by a one-off
 * removeItem, because that effect runs on every state change - a removeItem
 * anywhere else is undone by the very next dispatch. These tests drive the
 * real provider so they would catch exactly that.
 */
const STORAGE_KEY = "arc_campaign_wizard";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

/* The probe writes the hook's value out of the render so the assertions
   below can reach it. react-hooks objects to that on principle and is right
   to in component code; this is a test harness, and eslint.config.mjs scopes
   the rule to a warning under tests/ for exactly this. */
let api: ReturnType<typeof useWizard>;
function Probe() {
  api = useWizard();
  return null;
}

function mount() {
  act(() => {
    root.render(
      <WizardProvider>
        <Probe />
      </WizardProvider>
    );
  });
}

describe("a launched brief is not an unfinished one", () => {
  it("writes the draft while the brief is being filled in", () => {
    mount();
    act(() => { api.dispatch({ type: "UPDATE_BRIEF", brief: { productName: "Eid Push" } }); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it("deletes the draft once the campaign exists", () => {
    mount();
    act(() => { api.dispatch({ type: "UPDATE_BRIEF", brief: { productName: "Eid Push" } }); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();

    act(() => { api.dispatch({ type: "LAUNCHED", id: "cmp_1" }); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  /* The whole reason the flag lives in state. A plain removeItem at the call
     site would be overwritten by the next dispatch, and there is always a next
     dispatch. */
  it("keeps it deleted when anything dispatches afterwards", () => {
    mount();
    act(() => { api.dispatch({ type: "UPDATE_BRIEF", brief: { productName: "Eid Push" } }); });
    act(() => { api.dispatch({ type: "LAUNCHED", id: "cmp_1" }); });
    act(() => { api.dispatch({ type: "SET_STEP", step: "review" }); });
    act(() => { api.dispatch({ type: "UPDATE_BRIEF", brief: { productName: "Edited after launch" } }); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("records the created campaign id", () => {
    const s = reducer({ draftId: null, launched: false } as WizardState, { type: "LAUNCHED", id: "cmp_9" });
    expect(s.draftId).toBe("cmp_9");
    expect(s.launched).toBe(true);
  });

  it("a brief that was never launched still persists, so Resume still works", () => {
    mount();
    act(() => { api.dispatch({ type: "UPDATE_BRIEF", brief: { productName: "Half done" } }); });
    act(() => { api.dispatch({ type: "SET_STEP", step: "select" }); });
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.state.step).toBe("select");
    expect(saved.state.launched).toBe(false);
  });
});
