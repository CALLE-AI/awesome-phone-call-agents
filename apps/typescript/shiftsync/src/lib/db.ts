import { Employee, CoverageRequest, CallAttempt, CoverageWorkflowState, DashboardMetrics, TimelineEvent } from '@/types';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'shiftsync_db.json');

export interface DatabaseSchema {
  staff: Employee[];
  activeWorkflow: CoverageWorkflowState | null;
  history: CoverageWorkflowState[];
  metrics: DashboardMetrics;
}

const DEFAULT_STAFF: Employee[] = [
  {
    id: 'emp_alex',
    name: 'Alex Rivera',
    phone: '+15550192831',
    role: 'Bartender',
    priority: 1,
    notes: 'Senior mixologist, usually free Monday nights'
  },
  {
    id: 'emp_david',
    name: 'David Kim',
    phone: '+15550148291',
    role: 'Bartender',
    priority: 2,
    notes: 'Part-time bartender'
  },
  {
    id: 'emp_james',
    name: 'James Thornton',
    phone: '+15550183742',
    role: 'Bartender',
    priority: 3,
    notes: 'Available on-call for weekend and evening coverage'
  },
  {
    id: 'emp_sarah',
    name: 'Sarah Chen',
    phone: '+15550193721',
    role: 'Cashier',
    priority: 1,
    notes: 'Front counter lead'
  },
  {
    id: 'emp_elena',
    name: 'Elena Rostova',
    phone: '+15550129482',
    role: 'Server',
    priority: 1,
    notes: 'Floor lead'
  },
  {
    id: 'emp_marcus',
    name: 'Marcus Bell',
    phone: '+15550172940',
    role: 'Cook',
    priority: 1,
    notes: 'Line cook'
  }
];

class MemoryDatabase {
  private state: DatabaseSchema;

  constructor() {
    this.state = this.loadFromFile();
  }

  private loadFromFile(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Failed to read db file, using defaults:', err);
    }

    return {
      staff: [...DEFAULT_STAFF],
      activeWorkflow: null,
      history: [],
      metrics: {
        openShifts: 1,
        callsMade: 0,
        coverageFound: 0,
        estMinutesSaved: 0
      }
    };
  }

  private persist() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist db:', err);
    }
  }

  getStaff(): Employee[] {
    return this.state.staff;
  }

  getStaffByRole(role: string): Employee[] {
    return this.state.staff
      .filter(e => e.role.toLowerCase() === role.toLowerCase())
      .sort((a, b) => (a.priority || 99) - (b.priority || 99));
  }

  updateStaff(employee: Employee): Employee {
    const idx = this.state.staff.findIndex(e => e.id === employee.id);
    if (idx >= 0) {
      this.state.staff[idx] = employee;
    } else {
      this.state.staff.push(employee);
    }
    this.persist();
    return employee;
  }

  getActiveWorkflow(): CoverageWorkflowState | null {
    return this.state.activeWorkflow;
  }

  setActiveWorkflow(workflow: CoverageWorkflowState | null) {
    this.state.activeWorkflow = workflow;
    if (workflow && (workflow.status === 'covered' || workflow.status === 'no_coverage' || workflow.status === 'conditional_review')) {
      // Archive to history if complete
      const existingIdx = this.state.history.findIndex(h => h.requestId === workflow.requestId);
      if (existingIdx >= 0) {
        this.state.history[existingIdx] = workflow;
      } else {
        this.state.history.unshift(workflow);
      }

      // Update metrics
      this.state.metrics.callsMade = this.state.history.reduce((acc, h) => acc + h.attempts.length, 0);
      this.state.metrics.coverageFound = this.state.history.filter(h => h.status === 'covered').length;
      this.state.metrics.estMinutesSaved = this.state.metrics.callsMade * 12; // ~12 minutes per manual phone chase
      this.state.metrics.openShifts = this.state.history.filter(h => h.status === 'searching' || h.status === 'conditional_review').length;
    }
    this.persist();
  }

  getMetrics(): DashboardMetrics {
    return this.state.metrics;
  }

  resetDemo() {
    this.state = {
      staff: [...DEFAULT_STAFF],
      activeWorkflow: null,
      history: [],
      metrics: {
        openShifts: 1,
        callsMade: 0,
        coverageFound: 0,
        estMinutesSaved: 0
      }
    };
    this.persist();
  }
}

// Global singleton for Next.js hot-reloads
const globalForDb = global as unknown as { dbInstance?: MemoryDatabase };
export const db = globalForDb.dbInstance ?? new MemoryDatabase();
if (process.env.NODE_ENV !== 'production') globalForDb.dbInstance = db;
