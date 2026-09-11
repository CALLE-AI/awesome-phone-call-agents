/**
 * Specialty catalog.
 *
 * Candidates are framed from NPPES, which filters by `taxonomy_description`.
 * That means the specialty is load-bearing: it decides which phone numbers get
 * dialed. Inferring it from free text would silently call the wrong kind of
 * practice, so the specialty is an explicit, closed choice with a taxonomy
 * string known to match real NPPES records.
 *
 * NPPES matches `taxonomy_description` as a substring, so "Endocrinology" also
 * matches "Internal Medicine, Endocrinology, Diabetes & Metabolism". Every
 * taxonomy below was checked against the live registry and returns records.
 */

export interface Specialty {
  /** Stable id stored on the watch. */
  id: string;
  /** Label shown in the UI. */
  label: string;
  /** NPPES `taxonomy_description` filter. */
  taxonomy: string;
}

export const SPECIALTIES = [
  // Behavioral health: the case where directory rot hurts most.
  { id: "psychiatry", label: "Psychiatry", taxonomy: "Psychiatry" },
  { id: "psychology", label: "Psychology", taxonomy: "Psychologist" },
  { id: "counseling", label: "Counseling / therapy", taxonomy: "Counselor" },
  { id: "clinical-social-work", label: "Clinical social work", taxonomy: "Social Worker" },
  // Primary care.
  { id: "family-medicine", label: "Family medicine", taxonomy: "Family Medicine" },
  { id: "internal-medicine", label: "Internal medicine", taxonomy: "Internal Medicine" },
  { id: "pediatrics", label: "Pediatrics", taxonomy: "Pediatrics" },
  { id: "nurse-practitioner", label: "Nurse practitioner", taxonomy: "Nurse Practitioner" },
  { id: "obgyn", label: "OB-GYN", taxonomy: "Obstetrics & Gynecology" },
  // Specialties.
  { id: "allergy-immunology", label: "Allergy & immunology", taxonomy: "Allergy & Immunology" },
  { id: "cardiology", label: "Cardiology", taxonomy: "Cardiovascular Disease" },
  { id: "dentist", label: "Dentistry", taxonomy: "Dentist" },
  { id: "dermatology", label: "Dermatology", taxonomy: "Dermatology" },
  { id: "endocrinology", label: "Endocrinology", taxonomy: "Endocrinology" },
  { id: "ent", label: "ENT / otolaryngology", taxonomy: "Otolaryngology" },
  { id: "gastroenterology", label: "Gastroenterology", taxonomy: "Gastroenterology" },
  { id: "nephrology", label: "Nephrology", taxonomy: "Nephrology" },
  { id: "neurology", label: "Neurology", taxonomy: "Neurology" },
  { id: "oncology", label: "Oncology", taxonomy: "Hematology & Oncology" },
  { id: "ophthalmology", label: "Ophthalmology", taxonomy: "Ophthalmology" },
  { id: "optometry", label: "Optometry", taxonomy: "Optometrist" },
  { id: "orthopaedic-surgery", label: "Orthopaedic surgery", taxonomy: "Orthopaedic Surgery" },
  { id: "pain-medicine", label: "Pain medicine", taxonomy: "Pain Medicine" },
  { id: "podiatry", label: "Podiatry", taxonomy: "Podiatrist" },
  { id: "pulmonology", label: "Pulmonology", taxonomy: "Pulmonary Disease" },
  { id: "rheumatology", label: "Rheumatology", taxonomy: "Rheumatology" },
  { id: "sleep-medicine", label: "Sleep medicine", taxonomy: "Sleep Medicine" },
  { id: "urology", label: "Urology", taxonomy: "Urology" },
  // Therapies.
  { id: "chiropractic", label: "Chiropractic", taxonomy: "Chiropractor" },
  { id: "occupational-therapy", label: "Occupational therapy", taxonomy: "Occupational Therapist" },
  { id: "physical-therapy", label: "Physical therapy", taxonomy: "Physical Therapist" },
  {
    id: "speech-language-pathology",
    label: "Speech-language pathology",
    taxonomy: "Speech-Language Pathologist",
  },
] as const satisfies readonly Specialty[];

export type SpecialtyId = (typeof SPECIALTIES)[number]["id"];

const BY_ID = new Map<string, Specialty>(SPECIALTIES.map((s) => [s.id, s]));

/** Non-empty tuple of ids, for building a closed validation schema. */
export const SPECIALTY_IDS = SPECIALTIES.map((s) => s.id) as unknown as [
  SpecialtyId,
  ...SpecialtyId[],
];

export function isSpecialtyId(value: string): value is SpecialtyId {
  return BY_ID.has(value);
}

/** Look up a specialty, or null when the id is unknown. Never guesses. */
export function getSpecialty(id: string): Specialty | null {
  return BY_ID.get(id) ?? null;
}

/** Label for display. Falls back to the raw id so old watches still render. */
export function specialtyLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/** NPPES taxonomy filter for an id. Throws rather than dialing the wrong set. */
export function taxonomyFor(id: string): string {
  const specialty = BY_ID.get(id);
  if (!specialty) throw new Error(`unknown_specialty:${id}`);
  return specialty.taxonomy;
}
