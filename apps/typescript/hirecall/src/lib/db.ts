import { createClient, type Client, type InValue } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type CandidateRow = {
  id: string;
  name: string;
  phone: string;
  consent: boolean;
  resumeUrl: string;
  sourceFilename: string;
  createdAt: string;
};

export type CandidateInput = {
  name: string;
  phone: string;
  consent: boolean;
  resumeUrl: string;
};

const globalForDb = globalThis as unknown as { hirecallClient?: Client };

function dbFileUrl(): string {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  return "file:data/hirecall.db";
}

function getClient(): Client {
  if (!globalForDb.hirecallClient) {
    globalForDb.hirecallClient = createClient({ url: dbFileUrl() });
  }
  return globalForDb.hirecallClient;
}

async function migrate(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      consent INTEGER NOT NULL DEFAULT 0,
      resume_url TEXT NOT NULL DEFAULT '',
      source_filename TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
}

function mapRow(row: Record<string, unknown>): CandidateRow {
  return {
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone),
    consent: Number(row.consent) === 1,
    resumeUrl: String(row.resume_url ?? ""),
    sourceFilename: String(row.source_filename ?? ""),
    createdAt: String(row.created_at),
  };
}

export async function listCandidates(): Promise<CandidateRow[]> {
  const client = getClient();
  await migrate(client);
  const result = await client.execute(
    "SELECT id, name, phone, consent, resume_url, source_filename, created_at FROM candidates ORDER BY created_at DESC",
  );
  return result.rows.map((row) => mapRow(row as Record<string, unknown>));
}

export async function insertCandidates(
  rows: CandidateInput[],
  sourceFilename: string,
): Promise<CandidateRow[]> {
  const client = getClient();
  await migrate(client);
  const createdAt = new Date().toISOString();
  const inserted: CandidateRow[] = [];

  for (const row of rows) {
    const id = crypto.randomUUID();
    const args: InValue[] = [
      id,
      row.name,
      row.phone,
      row.consent ? 1 : 0,
      row.resumeUrl,
      sourceFilename,
      createdAt,
    ];
    await client.execute({
      sql: `INSERT INTO candidates (id, name, phone, consent, resume_url, source_filename, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args,
    });
    inserted.push({
      id,
      name: row.name,
      phone: row.phone,
      consent: row.consent,
      resumeUrl: row.resumeUrl,
      sourceFilename,
      createdAt,
    });
  }

  return inserted;
}

export async function clearCandidates(): Promise<number> {
  const client = getClient();
  await migrate(client);
  const before = await client.execute("SELECT COUNT(*) AS n FROM candidates");
  const count = Number(before.rows[0]?.n ?? 0);
  await client.execute("DELETE FROM candidates");
  return count;
}
