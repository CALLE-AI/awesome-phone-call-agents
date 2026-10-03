import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
export class Store {
  db: DatabaseSync;
  constructor(path = resolve("data/last-crate.sqlite")) {
    mkdirSync(resolve(path, ".."), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS budget (id TEXT PRIMARY KEY);",
    );
  }
  save(run: any) {
    const saved = this.get(run.id);
    // A stop written while a provider request awaits must survive stale worker saves.
    if (saved?.stopped) {
      run.stopped = true;
      for (const event of saved.events.filter(
        (e: any) => e.title === "Stop requested",
      ))
        if (
          !run.events.some(
            (e: any) => e.at === event.at && e.title === event.title,
          )
        )
          run.events.push(event);
    }
    this.db
      .prepare(
        "INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(run.id, JSON.stringify(run));
  }
  get(id: string): any {
    const row = this.db
      .prepare("SELECT body FROM runs WHERE id=?")
      .get(id) as any;
    return row ? JSON.parse(row.body) : null;
  }
  byKey(key: string): any {
    const row = this.db
      .prepare(
        "SELECT body FROM runs WHERE json_extract(body, '$.clientKey')=?",
      )
      .get(key) as any;
    return row ? JSON.parse(row.body) : null;
  }
  all(): any[] {
    return (
      this.db
        .prepare("SELECT body FROM runs ORDER BY rowid DESC LIMIT 100")
        .all() as any[]
    ).map((r) => JSON.parse(r.body));
  }
  used() {
    return Number(
      (this.db.prepare("SELECT count(*) AS count FROM budget").get() as any)
        .count,
    );
  }
  reserve(key: string, max: number) {
    if (this.db.prepare("SELECT id FROM budget WHERE id=?").get(key)) return;
    if (this.used() >= max)
      throw Error("Live call cap reached. No additional calls were placed.");
    this.db.prepare("INSERT INTO budget VALUES (?)").run(key);
  }
}
