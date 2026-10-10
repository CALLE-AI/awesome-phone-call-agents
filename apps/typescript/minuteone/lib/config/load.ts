import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { businessConfig } from "../db/schema";
import { businessConfigSchema, type BusinessConfig } from "./schema";
import exampleConfig from "./business.example.json";

/** Single-tenant: exactly one config row, this fixed id. */
const SINGLETON_ID = "singleton";

/**
 * Always-open default hours for the lazily-seeded config, so a fresh setup can be live-tested
 * immediately via /setup instead of silently hanging on the business-hours gate. The bundled
 * business.example.json still ships its own realistic Mon-Fri 9-18 window as reference content —
 * this override only applies to the first-ever seed written to the DB.
 */
const ALWAYS_OPEN_HOURS = {
  timezone: "America/New_York",
  days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const,
  start: "00:00",
  end: "23:59",
};

/** Reads the single business config, lazily seeding it from business.example.json on first call. */
export async function loadBusinessConfig(): Promise<BusinessConfig> {
  const [row] = await db.select().from(businessConfig).where(eq(businessConfig.id, SINGLETON_ID)).limit(1);
  if (row) return businessConfigSchema.parse(row.config);

  const seeded = businessConfigSchema.parse({
    ...businessConfigSchema.parse(exampleConfig),
    businessHours: ALWAYS_OPEN_HOURS,
  });
  await db.insert(businessConfig).values({ id: SINGLETON_ID, config: seeded });
  return seeded;
}

export async function saveBusinessConfig(config: BusinessConfig): Promise<void> {
  const validated = businessConfigSchema.parse(config);
  await db
    .insert(businessConfig)
    .values({ id: SINGLETON_ID, config: validated })
    .onConflictDoUpdate({
      target: businessConfig.id,
      set: { config: validated, updatedAt: new Date() },
    });
}
