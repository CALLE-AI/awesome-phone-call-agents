import type { ImportedWorkflowItem } from "./integrations/contracts";

export type ServiceKey = "approval_payment_follow_up" | "meeting_scheduling" | "employee_document_expiry" | "supplier_quotation";
export type WorkflowItem = ImportedWorkflowItem;
export type WorkflowSettings = { enabled: boolean; automaticCalling: boolean; daysBefore: number };
export type Workflow = { subject: string; items: WorkflowItem[]; settings: WorkflowSettings };
