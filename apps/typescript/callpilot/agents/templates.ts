import type { MissionCategory } from "@/types";

export interface AgentTemplate {
  id: MissionCategory;
  name: string;
  tagline: string;
  goal: string;
  questions: string[];
  constraints: string[];
  desiredOutcome: string;
  resultHint: string;
}

export const TEMPLATES: AgentTemplate[] = [
  {
    id: "appointment",
    name: "Appointment Agent",
    tagline: "Find the earliest available slot",
    goal: "Ask for the earliest available appointment next week and collect booking requirements.",
    questions: ["What appointment times are available next week?", "What is the earliest afternoon appointment?", "What information is required to book?"],
    constraints: ["Prefer afternoon appointments", "Do not confirm anything without user approval"],
    desiredOutcome: "Obtain available appointment options",
    resultHint: "availability[]",
  },
  {
    id: "quote",
    name: "Quote Agent",
    tagline: "Collect pricing from a provider",
    goal: "Request an itemized quote for the described service and collect price, validity and requirements.",
    questions: ["What is the total price?", "What does the price include?", "How long is the quote valid?", "What do you need from us to proceed?"],
    constraints: ["Do not accept or pay anything", "Information gathering only unless user approves"],
    desiredOutcome: "Structured price quote",
    resultHint: "price + requirements",
  },
  {
    id: "lead",
    name: "Lead Qualification Agent",
    tagline: "Qualify a business lead",
    goal: "Qualify the lead: need, budget, timeline, decision maker.",
    questions: ["What problem are you trying to solve?", "What budget range applies?", "What timeline are you on?", "Who makes the final decision?"],
    constraints: ["Be polite and concise", "Do not make promises about pricing"],
    desiredOutcome: "Qualified / unqualified verdict with reasons",
    resultHint: "notes + next_action",
  },
  {
    id: "availability",
    name: "Availability Agent",
    tagline: "Verify service availability",
    goal: "Determine whether the requested service is available, where and when.",
    questions: ["Is this service currently available?", "What are your operating hours?", "Are there blackout dates?"],
    constraints: ["Do not book anything", "Collect facts only"],
    desiredOutcome: "Yes/no availability + hours",
    resultHint: "availability + notes",
  },
  {
    id: "service",
    name: "Service Coordination Agent",
    tagline: "Coordinate between services",
    goal: "Coordinate information between the business and the user: scope, timing, access, contacts.",
    questions: ["Can you perform this scope?", "What is the earliest you could start?", "What access or preparation is needed?", "Who is the on-site contact?"],
    constraints: ["Low-risk coordination only", "Escalate irreversible commitments for approval"],
    desiredOutcome: "Coordination plan with owner + timing",
    resultHint: "requirements + next_action",
  },
  {
    id: "followup",
    name: "Follow-Up Agent",
    tagline: "Follow up on a prior request",
    goal: "Follow up on a previous interaction and get a status update plus next step.",
    questions: ["What is the current status?", "Is anything blocking progress?", "When should we check back?"],
    constraints: ["Reference the prior request clearly", "Do not reopen closed items without approval"],
    desiredOutcome: "Status update + next step",
    resultHint: "notes + next_action",
  },
];
