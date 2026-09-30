import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { withFileLock } from "./file-lock";

export interface JsonTransaction<State> { transact<T>(operation: (state: State) => T): Promise<T> }
export class EncryptedJsonStore<State extends { version: number }> implements JsonTransaction<State> {
  private readonly key: Buffer;
  constructor(private readonly path: string, secret: string, private readonly empty: () => State) {
    if (secret.length < 32) throw new Error("Storage key must contain at least 32 characters");
    this.key = createHash("sha256").update("calle-followup:v1\0").update(secret).digest();
  }
  async transact<T>(operation: (state: State) => T): Promise<T> {
    return withFileLock(`${this.path}.lock`, async () => {
      let state = this.empty();
      try {
        const encrypted = JSON.parse(await readFile(this.path, "utf8"));
        const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encrypted.iv, "base64"));
        decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
        state = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.body, "base64")), decipher.final()]).toString("utf8"));
        if (state.version !== 1) throw new Error("Invalid state version");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read encrypted follow-up state");
      }
      const result = operation(state);
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]);
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), body: body.toString("base64") }), { mode: 0o600 });
      await rename(temporary, this.path);
      return result;
    });
  }
}
