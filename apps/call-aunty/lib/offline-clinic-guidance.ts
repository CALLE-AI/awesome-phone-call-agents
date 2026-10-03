export type OfflineClinicGuidanceTopic = { id: "clinic-visit" | "emergency-contact" | "community-health-worker"; title: string; body: string };

export const OFFLINE_CLINIC_GUIDANCE_VERSION = "2026.08";

export const offlineClinicGuidance: OfflineClinicGuidanceTopic[] = [
  { id: "clinic-visit", title: "Clinic visit", body: "Keep your care-plan details ready and ask the health worker what to do next." },
  { id: "emergency-contact", title: "Urgent help", body: "If warning signs appear, contact local emergency services or the nearest trusted clinic." },
  { id: "community-health-worker", title: "Community health worker", body: "Your CHW can help connect local care, follow-up, and referral steps." },
];

export function getOfflineClinicGuidanceTopicCount(): number {
  return offlineClinicGuidance.length;
}
