export type EmployeeRole = 'Bartender' | 'Server' | 'Cashier' | 'Barista' | 'Cook' | 'Manager' | string;

export interface Employee {
  id: string;
  name: string;
  phone: string;
  role: EmployeeRole;
  priority?: number; // 1 = top priority
  notes?: string;
}

export type CoverageStatus = 
  | 'idle'
  | 'searching'
  | 'covered'
  | 'conditional_review'
  | 'no_coverage'
  | 'failed';

export type CallStatusOutcome = 
  | 'accepted'
  | 'declined'
  | 'conditional'
  | 'no_answer'
  | 'voicemail'
  | 'callback_requested'
  | 'invalid_number'
  | 'calling'
  | 'unknown';

export interface CallStructuredResult {
  status: CallStatusOutcome;
  employee_name: string;
  shift_date: string;
  available_from: string | null;
  notes: string;
  manager_review_required: boolean;
}

export interface TranscriptTurn {
  speaker: 'bot' | 'user' | string;
  text: string;
  offset_seconds?: number;
}

export interface CallAttempt {
  id: string;
  requestId: string;
  employeeId: string;
  employeeName: string;
  phone: string;
  attemptNumber: number;
  status: 'queued' | 'calling' | 'completed' | 'failed';
  outcome?: CallStatusOutcome;
  calleCallId?: string;
  durationSeconds?: number;
  summary?: string;
  transcriptTurns?: TranscriptTurn[];
  structuredResult?: CallStructuredResult;
  startedAt: string;
  completedAt?: string;
  isSimulated?: boolean;
}

export interface CoverageRequest {
  id: string;
  role: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  workersNeeded: number;
  status: CoverageStatus;
  createdAt: string;
  businessName?: string;
  scenario?: 'standard' | 'conditional';
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'call';
}

export interface CoverageWorkflowState {
  requestId: string;
  request: CoverageRequest;
  candidates: Employee[];
  currentIndex: number;
  attempts: CallAttempt[];
  status: CoverageStatus;
  confirmedEmployee?: Employee;
  confirmedResult?: CallStructuredResult;
  timeline: TimelineEvent[];
  mode: 'live' | 'simulation';
  error?: string;
}

export interface DashboardMetrics {
  openShifts: number;
  callsMade: number;
  coverageFound: number;
  estMinutesSaved: number;
}
