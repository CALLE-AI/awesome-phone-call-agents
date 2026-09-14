export type Shipment = {
  reference: string;
  cargo: string;
  origin: string;
  destination: string;
  carrier: string;
  cutoffDate: string;
  cutoffTime: string;
  contact: string;
  phone: string;
  priority: "Critical";
  concerns: string[];
};
export type ReadinessCheckForm = Omit<Shipment, "priority" | "concerns"> & {
  concerns: string;
  callTiming: "now" | "schedule";
  consent: boolean;
};
export type Operation = {
  id: string;
  reference: string;
  description: string;
  route: string;
  status: string;
  queueState: "Ready for assessment" | "Scheduled" | "Done" | "Queued";
  isInteractive: boolean;
  isSample: boolean;
};
