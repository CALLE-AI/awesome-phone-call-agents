export type IntegrationProviderKey = "manual" | "clickup";

export type IntegrationCapability =
  | "discover_workspaces"
  | "discover_sources"
  | "discover_fields"
  | "preview_records"
  | "import_records"
  | "comment_writeback";

export type IntegrationProviderDefinition = {
  key: IntegrationProviderKey;
  name: string;
  description: string;
  authModes: Array<"none" | "personal_token" | "oauth">;
  capabilities: IntegrationCapability[];
  documentationUrl?: string;
};

export type SourceField = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "phone" | "status" | "users";
};

export type SourceStatus = {
  name: string;
  type: string;
};

export type IntegrationSourceType = "list" | "folder" | "space";

export type WorkflowContextField = {
  key: string;
  label: string;
  value: string;
  type: SourceField["type"];
};

export type WorkflowFieldMapping = {
  itemName: string;
  date?: string;
  startDateTime?: string;
  endDateTime?: string;
  attendees?: string;
  meetingRequestStatus?: string;
  meetingScheduledStatus?: string;
  meetingWritebackStartDate?: string;
  meetingWritebackEndDate?: string;
  automaticMeetingUpdate?: boolean;
  availabilityWorkingDays?: number[];
  availabilityStartTime?: string;
  availabilityEndTime?: string;
  availabilitySearchDays?: number;
  availabilityNoticeHours?: number;
  availabilityStepMinutes?: number;
  availabilityBufferMinutes?: number;
  availabilityMaxOptions?: number;
  quantity?: string;
  unit?: string;
  contactName?: string;
  contactCompany?: string;
  contactPhone?: string;
  defaultDurationMinutes?: number;
  defaultQuantity?: number;
  defaultUnit?: string;
};

export const DEFAULT_MEETING_AVAILABILITY = {
  availabilityWorkingDays: [0, 1, 2, 3, 4],
  availabilityStartTime: "09:00",
  availabilityEndTime: "17:00",
  availabilitySearchDays: 14,
  availabilityNoticeHours: 2,
  availabilityStepMinutes: 30,
  availabilityBufferMinutes: 15,
  availabilityMaxOptions: 5,
};

export type ImportedWorkflowItem = {
  name: string;
  quantity: number;
  date?: string;
  startTime?: string;
  endTime?: string;
  unit?: string;
  availability?: {
    status: "available" | "unavailable" | "needs_scheduling";
    reason?: string;
    conflicts?: Array<{
      taskId: string;
      name: string;
      status: string;
      startAt: string;
      endAt: string;
    }>;
  };
  source?: {
    provider: IntegrationProviderKey;
    recordId: string;
    url?: string;
    sourceName?: string;
    fields?: WorkflowContextField[];
    contactPhoneFieldKey?: string;
    meeting?: {
      slotId?: string;
      startAt?: string;
      endAt?: string;
      generated?: boolean;
      requestStatus: string;
      attendeeIds: string[];
      attendeeNames: string[];
    };
  };
};
