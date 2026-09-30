import { mkdirSync, renameSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

let writeSequence = 0;

export const writeJsonAtomic = (filePath, value) => {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${++writeSequence}.tmp`;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(tempFile, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tempFile, filePath);
  } catch (error) {
    try { unlinkSync(tempFile); } catch { /* best effort cleanup */ }
    throw error;
  }
};

export class JsonStateStore {
  constructor(filePath, seedFactory) {
    this.filePath = filePath;
    this.seedFactory = seedFactory;
    this.state = null;
  }

  load() {
    if (this.state) return this.state;
    try {
      this.state = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      this.state = this.seedFactory();
      this.save();
    }
    return this.state;
  }

  save() {
    writeJsonAtomic(this.filePath, this.state ?? this.seedFactory());
    return this.state;
  }

  reset() {
    this.state = this.seedFactory();
    this.save();
    return this.state;
  }
}
