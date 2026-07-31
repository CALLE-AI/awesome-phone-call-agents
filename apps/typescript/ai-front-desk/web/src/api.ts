export interface Contact {
  id: string;
  name: string;
  phone: string;
}

export interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
  serviceType: string;
  status: string;
}

export interface Appointment {
  id: string;
  status: string;
  confirmationCallStatus: string;
  contact: Contact;
  slot: Slot | null;
}

export interface WaitlistEntry {
  id: string;
  priority: number;
  status: string;
  desiredServiceType: string;
  contact: Contact;
}

export interface Lead {
  id: string;
  rawInquiry: string;
  reasonForVisit: string | null;
  preferredTimeframe: string | null;
  status: string;
  contact: Contact | null;
  createdAt: string;
}

export interface CallLog {
  id: string;
  flow: string;
  status: string;
  task: string;
  resultSchema: string;
  structuredResult: string | null;
  transcript: string | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: string | null;
  dryRun: boolean;
  calleCallId: string | null;
  createdAt: string;
}

export interface AppStatus {
  dryRun: boolean;
  liveCallsUsed: number;
  freeTierTotal: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  status: () => request<AppStatus>("/api/status"),
  appointments: () => request<Appointment[]>("/api/appointments"),
  waitlist: () => request<WaitlistEntry[]>("/api/waitlist"),
  leads: () => request<Lead[]>("/api/leads"),
  calls: () => request<CallLog[]>("/api/calls"),
  simulateConfirm: (appointmentId: string, mock: "attend" | "decline") =>
    request("/api/simulate/confirm-nearing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId, mock }),
    }),
  simulateCancellation: (appointmentId: string) =>
    request("/api/simulate/cancellation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId }),
    }),
  simulateNewLead: (input: { name: string; phone: string; inquiry: string }) =>
    request("/api/simulate/new-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
};
