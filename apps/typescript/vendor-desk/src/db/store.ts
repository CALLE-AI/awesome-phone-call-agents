import fs from "fs";
import path from "path";
import { CallJob } from "../types";

const DB_FILE = path.join(process.cwd(), "db.json");

let jobs = new Map<string, CallJob>();

function load(): void {
  if (!fs.existsSync(DB_FILE)) return;
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const parsed: CallJob[] = JSON.parse(raw);
    jobs = new Map(parsed.map((job) => [job.id, job]));
  } catch (err) {
    console.error("Failed to load db.json, starting with an empty store:", err);
  }
}

function persist(): void {
  const arr = Array.from(jobs.values());
  fs.writeFileSync(DB_FILE, JSON.stringify(arr, null, 2), "utf-8");
}

load();

export const store = {
  createJob(job: CallJob): CallJob {
    jobs.set(job.id, job);
    persist();
    return job;
  },

  getJob(id: string): CallJob | undefined {
    return jobs.get(id);
  },

  getJobByCalleCallId(calleCallId: string): CallJob | undefined {
    return Array.from(jobs.values()).find((j) => j.calleCallId === calleCallId);
  },

  updateJob(id: string, patch: Partial<CallJob>): CallJob | undefined {
    const existing = jobs.get(id);
    if (!existing) return undefined;
    const updated: CallJob = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    jobs.set(id, updated);
    persist();
    return updated;
  },

  listJobs(): CallJob[] {
    return Array.from(jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },
};
