export type Readiness = "ready" | "conditional" | "blocked" | "unknown";

export type ConflictType =
  | "ACCESS_BEFORE_OPEN"
  | "DOCK_COLLISION"
  | "POWER_CAPACITY_EXCEEDED"
  | "SETUP_DEADLINE_MISSED"
  | "READINESS_NOT_CONFIRMED"
  | "UNKNOWN_INPUT";

export interface VenueConstraints {
  accessStart: string;
  dockCapacity: number;
  availablePowerAmps: number;
  readyBy: string;
}

export interface VendorPlan {
  id: string;
  name: string;
  category: string;
  demoPhone: string;
  readiness: Readiness;
  arrivalTime: string;
  setupCompleteTime: string;
  needsLoadingDock: "yes" | "no" | "unknown";
  dockStart: string;
  dockEnd: string;
  powerAmps: number;
  blocker: string;
  evidence: string;
  callStatus: "planned" | "calling" | "completed" | "failed";
}

export interface Conflict {
  id: string;
  type: ConflictType;
  title: string;
  detail: string;
  vendorIds: string[];
  evidence: string[];
  resolutionPrompt: string;
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function parseTime(value: string): number | null {
  if (!TIME_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA;
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours} hour${hours > 1 ? "s" : ""}`;
}

function unknownConflict(vendor: VendorPlan, field: string): Conflict {
  return {
    id: `unknown-${vendor.id}-${field}`,
    type: "UNKNOWN_INPUT",
    title: `Unusable ${field}`,
    detail: `${vendor.name} did not provide a valid ${field}. ReadyLine will not guess.`,
    vendorIds: [vendor.id],
    evidence: [vendor.evidence],
    resolutionPrompt: `Ask ${vendor.name} to confirm its ${field} in local 24-hour HH:mm format.`,
  };
}

export function detectConflicts(
  venue: VenueConstraints,
  vendors: VendorPlan[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  const accessStart = parseTime(venue.accessStart);
  const readyBy = parseTime(venue.readyBy);

  for (const vendor of vendors) {
    const arrival = parseTime(vendor.arrivalTime);
    const setupComplete = parseTime(vendor.setupCompleteTime);

    // Required operational fields fail closed: an unusable loading-dock
    // requirement is exactly as disqualifying as an unusable time or power
    // value — ReadyLine never guesses whether the dock is needed.
    if (vendor.needsLoadingDock === "unknown") {
      conflicts.push(unknownConflict(vendor, "loading-dock requirement"));
    }

    // A vendor that claims ready while stating a blocker returned a
    // self-contradictory result; treat readiness as not confirmed.
    const reportedBlocker = vendor.blocker.trim();
    if (vendor.readiness === "ready" && reportedBlocker.length > 0) {
      conflicts.push({
        id: `blocker-${vendor.id}`,
        type: "READINESS_NOT_CONFIRMED",
        title: "Ready reported despite a stated blocker",
        detail: `${vendor.name} confirmed readiness while reporting a blocker: ${reportedBlocker}`,
        vendorIds: [vendor.id],
        evidence: [vendor.evidence],
        resolutionPrompt: `Ask ${vendor.name} to resolve the reported blocker and reconfirm readiness.`,
      });
    }

    if (arrival === null) {
      conflicts.push(unknownConflict(vendor, "arrival time"));
    } else if (accessStart !== null && arrival < accessStart) {
      conflicts.push({
        id: `access-${vendor.id}`,
        type: "ACCESS_BEFORE_OPEN",
        title: "Arrival before venue access",
        detail: `${vendor.name} plans to arrive ${minutesLabel(accessStart - arrival)} before access begins at ${venue.accessStart}.`,
        vendorIds: [vendor.id],
        evidence: [vendor.evidence],
        resolutionPrompt: `Ask ${vendor.name} whether arrival can move to ${venue.accessStart} or later.`,
      });
    }

    if (setupComplete === null) {
      conflicts.push(unknownConflict(vendor, "setup completion time"));
    } else if (readyBy !== null && setupComplete > readyBy) {
      conflicts.push({
        id: `deadline-${vendor.id}`,
        type: "SETUP_DEADLINE_MISSED",
        title: "Setup misses readiness deadline",
        detail: `${vendor.name} completes at ${vendor.setupCompleteTime}, after the ${venue.readyBy} deadline.`,
        vendorIds: [vendor.id],
        evidence: [vendor.evidence],
        resolutionPrompt: `Ask ${vendor.name} for a plan that completes by ${venue.readyBy}.`,
      });
    }

    if (vendor.powerAmps < 0) {
      conflicts.push(unknownConflict(vendor, "power requirement"));
    } else if (vendor.powerAmps > venue.availablePowerAmps) {
      conflicts.push({
        id: `power-${vendor.id}`,
        type: "POWER_CAPACITY_EXCEEDED",
        title: "Power requirement exceeds venue capacity",
        detail: `${vendor.name} requests ${vendor.powerAmps}A; the venue provides ${venue.availablePowerAmps}A.`,
        vendorIds: [vendor.id],
        evidence: [vendor.evidence],
        resolutionPrompt: `Ask ${vendor.name} whether it can use a venue-approved setup within ${venue.availablePowerAmps}A.`,
      });
    }
  }

  const dockUsers = vendors.flatMap((vendor) => {
    if (vendor.needsLoadingDock !== "yes") return [];
    const start = parseTime(vendor.dockStart);
    const end = parseTime(vendor.dockEnd);
    if (start === null || end === null || end <= start) {
      conflicts.push(unknownConflict(vendor, "loading-dock window"));
      return [];
    }
    return [{ vendor, start, end }];
  });

  if (venue.dockCapacity === 1) {
    for (let first = 0; first < dockUsers.length; first += 1) {
      for (let second = first + 1; second < dockUsers.length; second += 1) {
        const a = dockUsers[first];
        const b = dockUsers[second];
        if (!intervalsOverlap(a.start, a.end, b.start, b.end)) continue;

        const overlapStart = Math.max(a.start, b.start);
        const overlapEnd = Math.min(a.end, b.end);
        const format = (value: number) =>
          `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

        conflicts.push({
          id: `dock-${a.vendor.id}-${b.vendor.id}`,
          type: "DOCK_COLLISION",
          title: "Loading-dock collision",
          detail: `${a.vendor.name} and ${b.vendor.name} overlap from ${format(overlapStart)}–${format(overlapEnd)}.`,
          vendorIds: [a.vendor.id, b.vendor.id],
          evidence: [a.vendor.evidence, b.vendor.evidence],
          resolutionPrompt: `Ask one vendor to move its dock window so only one team uses the dock at a time.`,
        });
      }
    }
  }

  for (const vendor of vendors) {
    if (vendor.readiness === "ready") continue;
    if (conflicts.some((conflict) => conflict.vendorIds.includes(vendor.id))) continue;
    const readiness = ["conditional", "blocked", "unknown"].includes(vendor.readiness)
      ? vendor.readiness
      : "invalid";
    conflicts.push({
      id: `readiness-${vendor.id}`,
      type: "READINESS_NOT_CONFIRMED",
      title: "Vendor readiness is not confirmed",
      detail: `${vendor.name} reported ${readiness} readiness. ReadyLine requires an explicit ready result.`,
      vendorIds: [vendor.id],
      evidence: [vendor.evidence],
      resolutionPrompt: `Ask ${vendor.name} to resolve its blocker and explicitly confirm readiness.`,
    });
  }

  return conflicts;
}

export function readinessSummary(vendors: VendorPlan[], conflicts: Conflict[]) {
  const vendorsWithConflicts = new Set(conflicts.flatMap((conflict) => conflict.vendorIds));
  const readyCount = vendors.filter(
    (vendor) => vendor.readiness === "ready" && !vendorsWithConflicts.has(vendor.id),
  ).length;

  // Independent fail-closed guard: even with an empty conflict list, unknown
  // loading-dock needs or a stated blocker on a self-claimed ready vendor keep
  // the overall plan BLOCKED.
  const hasUnresolvedOperationalInput = vendors.some(
    (vendor) =>
      vendor.needsLoadingDock === "unknown" ||
      (vendor.readiness === "ready" && vendor.blocker.trim().length > 0),
  );

  return {
    readyCount,
    totalCount: vendors.length,
    status:
      vendors.length > 0 &&
      conflicts.length === 0 &&
      !hasUnresolvedOperationalInput &&
      vendors.every((vendor) => vendor.readiness === "ready")
        ? ("ready" as const)
        : ("blocked" as const),
  };
}

export function conflictedVendorIds(conflicts: Conflict[]) {
  return new Set(conflicts.flatMap((conflict) => conflict.vendorIds));
}
