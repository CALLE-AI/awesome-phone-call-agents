import { addMinutes } from "./ids";
import type {
  AgentClock,
  AgentIdFactory,
  AgentRisk,
  ApprovalAction,
  ApprovalDecision,
  ApprovalStatus,
  ApprovalTicket,
} from "./types";

const TTL_MINUTES: Record<AgentRisk, number> = {
  low: 60,
  medium: 45,
  high: 30,
  critical: 15,
};

export class HumanApprovalGate {
  private readonly tickets = new Map<string, ApprovalTicket>();

  constructor(
    private readonly ids: AgentIdFactory,
    private readonly clock: AgentClock,
  ) {}

  request(input: {
    turnId: string;
    contactId: string;
    action: ApprovalAction;
    risk: AgentRisk;
    reasons: string[];
    requiredApprovals: number;
    summary: string;
  }): ApprovalTicket {
    const requestedAt = this.clock.nowIso();
    const ticket: ApprovalTicket = {
      id: this.ids.next("approval"),
      turnId: input.turnId,
      contactId: input.contactId,
      action: input.action,
      risk: input.risk,
      reasons: [...input.reasons],
      requiredApprovals: Math.max(1, input.requiredApprovals),
      status: "pending",
      requestedAt,
      expiresAt: addMinutes(requestedAt, TTL_MINUTES[input.risk]),
      decisions: [],
      summary: input.summary,
    };
    this.tickets.set(ticket.id, ticket);
    return cloneTicket(ticket);
  }

  get(id: string): ApprovalTicket | undefined {
    const ticket = this.tickets.get(id);
    return ticket ? cloneTicket(this.refresh(ticket)) : undefined;
  }

  pending(): ApprovalTicket[] {
    return [...this.tickets.values()]
      .map((ticket) => this.refresh(ticket))
      .filter((ticket) => ticket.status === "pending")
      .map(cloneTicket);
  }

  list(): ApprovalTicket[] {
    return [...this.tickets.values()].map((ticket) => cloneTicket(this.refresh(ticket)));
  }

  decide(id: string, operatorId: string, decision: "approve" | "deny", notes?: string): ApprovalTicket {
    const ticket = this.tickets.get(id);
    if (!ticket) throw new Error(`Unknown approval ticket: ${id}`);
    this.refresh(ticket);
    if (ticket.status !== "pending") {
      throw new Error(`Approval ticket ${id} is ${ticket.status}`);
    }

    const record: ApprovalDecision = {
      operatorId,
      decision,
      at: this.clock.nowIso(),
      notes,
    };

    if (decision === "deny") {
      ticket.decisions.push(record);
      ticket.status = "denied";
      return cloneTicket(ticket);
    }

    if (ticket.decisions.some((item) => item.operatorId === operatorId && item.decision === "approve")) {
      throw new Error("Operator already approved this ticket");
    }

    ticket.decisions.push(record);
    const approvals = uniqueApprovers(ticket);
    if (approvals >= ticket.requiredApprovals) {
      ticket.status = "approved";
    }
    return cloneTicket(ticket);
  }

  expireDue(nowIso?: string): number {
    const now = Date.parse(nowIso ?? this.clock.nowIso());
    let expired = 0;
    for (const ticket of this.tickets.values()) {
      if (ticket.status === "pending" && Date.parse(ticket.expiresAt) <= now) {
        ticket.status = "expired";
        expired += 1;
      }
    }
    return expired;
  }

  private refresh(ticket: ApprovalTicket): ApprovalTicket {
    if (ticket.status === "pending" && Date.parse(ticket.expiresAt) <= Date.parse(this.clock.nowIso())) {
      ticket.status = "expired";
    }
    return ticket;
  }
}

export function approvalMet(ticket: ApprovalTicket, required: ApprovalStatus = "approved"): boolean {
  return ticket.status === required;
}

function uniqueApprovers(ticket: ApprovalTicket): number {
  return new Set(
    ticket.decisions.filter((item) => item.decision === "approve").map((item) => item.operatorId),
  ).size;
}

function cloneTicket(ticket: ApprovalTicket): ApprovalTicket {
  return structuredClone(ticket);
}
