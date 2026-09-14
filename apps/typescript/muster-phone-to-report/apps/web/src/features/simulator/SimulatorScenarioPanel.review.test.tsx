import { describe, expect, it, vi } from "vitest";

import {
  captureLiveDemoBrowserHandoff,
  readLiveOperationIdentity,
  writeLiveOperationIdentity,
} from "./SimulatorScenarioPanel.js";

function memoryStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
    value: () => value,
  };
}

describe("live operation refresh identity", () => {
  it("captures the exact fragment tuple, scrubs the address bar, and stores only allowlisted fields", () => {
    const storage = memoryStorage();
    const replaceAddressBar = vi.fn();

    expect(
      captureLiveDemoBrowserHandoff({
        hash: "#operationId=operation-handoff-001&scenarioId=synthetic-normal&scenarioRevision=2",
        cleanAddress: "/simulator.html?presentation=review",
        storage,
        replaceAddressBar,
      }),
    ).toEqual({
      operationId: "operation-handoff-001",
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
    });
    expect(replaceAddressBar).toHaveBeenCalledOnce();
    expect(replaceAddressBar).toHaveBeenCalledWith("/simulator.html?presentation=review");
    expect(JSON.parse(storage.value() ?? "null")).toEqual({
      operationId: "operation-handoff-001",
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
    });
  });

  it("scrubs malformed or overprivileged fragments without persisting any handoff value", () => {
    const storage = memoryStorage();
    const replaceAddressBar = vi.fn();

    expect(
      captureLiveDemoBrowserHandoff({
        hash: "#operationId=operation-handoff-001&scenarioId=synthetic-normal&scenarioRevision=2&permit=forbidden",
        cleanAddress: "/simulator.html",
        storage,
        replaceAddressBar,
      }),
    ).toBeNull();
    expect(replaceAddressBar).toHaveBeenCalledWith("/simulator.html");
    expect(storage.value()).toBeNull();
  });

  it.each([
    "synthetic-abnormal",
    "synthetic-ambiguous",
    "synthetic-truncated",
    "synthetic-recovery",
  ])("persists and restores the admitted %s scenario tuple", (scenarioId) => {
    const storage = memoryStorage();
    const identity = {
      operationId: `operation-${scenarioId}`,
      scenarioId,
      scenarioRevision: 2,
    };

    writeLiveOperationIdentity(storage, identity);

    expect(JSON.parse(storage.value() ?? "null")).toEqual(identity);
    expect(readLiveOperationIdentity(storage)).toEqual(identity);
  });

  it("fails closed on legacy, malformed, and out-of-contract stored values", () => {
    for (const value of [
      "operation-legacy-only",
      JSON.stringify({ operationId: "operation-missing-scenario" }),
      JSON.stringify({
        operationId: "operation-invalid-revision",
        scenarioId: "synthetic-abnormal",
        scenarioRevision: 0,
      }),
      JSON.stringify({
        operationId: "operation-extra-field",
        scenarioId: "synthetic-abnormal",
        scenarioRevision: 2,
        permit: "must-never-be-stored",
      }),
    ]) {
      expect(readLiveOperationIdentity(memoryStorage(value))).toBeNull();
    }
  });

  it("removes a restored operation identity without retaining its scenario tuple", () => {
    const storage = memoryStorage(
      JSON.stringify({
        operationId: "operation-abnormal-a",
        scenarioId: "synthetic-abnormal",
        scenarioRevision: 2,
      }),
    );

    writeLiveOperationIdentity(storage, null);

    expect(storage.value()).toBeNull();
    expect(readLiveOperationIdentity(storage)).toBeNull();
  });
});
