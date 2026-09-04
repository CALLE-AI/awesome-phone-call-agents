export const DEFAULT_WORKFLOW_TYPE = "shift_coordination";

export const WORKFLOW_TEMPLATES = [
  {
    id: "appointment_management",
    label: "Appointment desk",
    business: "Service businesses",
    description: "Confirm or reschedule a customer appointment without changing the calendar automatically.",
    recipientLabel: "Customer",
    recordLabel: "Appointment",
    applyLabel: "appointment",
    demoEmployeeId: "emp-ana",
    demoShiftId: "shift-ana-1",
    demoOutcome: "reschedule_requested",
  },
  {
    id: "lead_follow_up",
    label: "Lead follow-up",
    business: "Sales teams",
    description: "Turn a phone conversation into a qualified follow-up time for a prospective customer.",
    recipientLabel: "Prospect",
    recordLabel: "Follow-up",
    applyLabel: "follow-up",
    demoEmployeeId: "emp-diego",
    demoShiftId: "shift-diego-1",
    demoOutcome: "confirmed",
  },
  {
    id: "shift_coordination",
    label: "Shift coordination",
    business: "Operations teams",
    description: "Check a team member's availability and safely confirm or renegotiate a work shift.",
    recipientLabel: "Team member",
    recordLabel: "Shift",
    applyLabel: "shift",
    demoEmployeeId: "emp-lucia",
    demoShiftId: "shift-lucia-1",
    demoOutcome: "declined",
  },
];

export const getWorkflowTemplate = (workflowType) =>
  WORKFLOW_TEMPLATES.find((template) => template.id === workflowType) ||
  WORKFLOW_TEMPLATES.find((template) => template.id === DEFAULT_WORKFLOW_TYPE);

export const publicWorkflowTemplates = () => WORKFLOW_TEMPLATES.map((template) => ({ ...template }));
