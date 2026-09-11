import type { VenueConstraints, VendorPlan } from "./constraint-engine";

export const fixtureVenue: VenueConstraints = {
  accessStart: "09:30",
  dockCapacity: 1,
  availablePowerAmps: 32,
  readyBy: "11:00",
};

export const initialVendorPlans: VendorPlan[] = [
  {
    id: "northstar-av",
    name: "Northstar AV",
    category: "Audio visual",
    demoPhone: "+12025550121",
    readiness: "conditional",
    arrivalTime: "09:00",
    setupCompleteTime: "11:00",
    needsLoadingDock: "yes",
    dockStart: "09:00",
    dockEnd: "10:00",
    powerAmps: 63,
    blocker: "Venue access and power require coordination.",
    evidence: "AV coordinator confirmed a 09:00 arrival, dock use until 10:00, and a 63A requirement.",
    callStatus: "completed",
  },
  {
    id: "field-and-fork",
    name: "Field & Fork",
    category: "Catering",
    demoPhone: "+12025550122",
    readiness: "ready",
    arrivalTime: "09:30",
    setupCompleteTime: "10:45",
    needsLoadingDock: "yes",
    dockStart: "09:30",
    dockEnd: "09:45",
    powerAmps: 16,
    blocker: "",
    evidence: "Catering confirmed dock use from 09:30 to 09:45 and setup complete by 10:45.",
    callStatus: "completed",
  },
  {
    id: "form-and-function",
    name: "Form & Function",
    category: "Decor",
    demoPhone: "+12025550123",
    readiness: "ready",
    arrivalTime: "10:00",
    setupCompleteTime: "10:50",
    needsLoadingDock: "no",
    dockStart: "",
    dockEnd: "",
    powerAmps: 0,
    blocker: "",
    evidence: "Decor confirmed a 10:00 arrival, no dock requirement, and completion by 10:50.",
    callStatus: "completed",
  },
];

export const resolvedVendorPlans: VendorPlan[] = initialVendorPlans.map((vendor) =>
  vendor.id === "northstar-av"
    ? {
        ...vendor,
        readiness: "ready",
        arrivalTime: "09:45",
        setupCompleteTime: "10:50",
        dockStart: "09:45",
        dockEnd: "10:15",
        powerAmps: 32,
        blocker: "",
        evidence:
          "AV coordinator confirmed a 09:45 arrival, dock use until 10:15, and a venue-approved 32A setup.",
      }
    : vendor,
);

export const resolutionCallGoal =
  "Venue access begins at 09:30, the loading dock is available after 09:45, and venue power is limited to 32A. Ask Northstar AV whether they can use the dock from 09:45–10:15 and provide a venue-approved setup within 32A. Do not make commitments on behalf of the event manager.";
