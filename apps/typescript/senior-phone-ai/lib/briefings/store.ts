import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireSecret } from "../config/server";
import { searchLiveWeb } from "../tools/search-web-provider";
import { localClock, renderBriefingTask, SHARED_BRIEFING_PROFILE, validateProfile, type DailyBriefing, type SeniorProfile } from "./model";
import { prepareBriefing } from "./service";

interface State { profiles: SeniorProfile[]; briefings: DailyBriefing[] }
const directory = join(process.cwd(), "data");
const path = join(directory, "senior-briefings.enc.json");
const lockPath = join(directory, "senior-briefings.lock");
function key() { return createHash("sha256").update("senior-briefings:v1\0").update(requireSecret("CALLE_API_KEY")).digest(); }
export function profileFingerprint(profile: SeniorProfile) { return createHash("sha256").update(JSON.stringify(profile)).digest("hex"); }

export async function readBriefingState(): Promise<State> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { profiles: [], briefings: [] };
    throw error;
  }
  const sealed = JSON.parse(raw);
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.body, "base64")), decipher.final()]).toString("utf8")) as State;
}

async function withState<T>(operation: (state: State) => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true });
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); } catch { throw new Error("Briefing preparation or profile update is already running; try again later"); }
  try {
    const state = await readBriefingState();
    const result = await operation(state);
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), body: body.toString("base64") }), { mode: 0o600 });
    await rename(temporary, path);
    return result;
  } finally { await lock.close(); await unlink(lockPath); }
}

export async function saveProfile(input: unknown) {
  const profile = validateProfile(input);
  return withState(async (state) => {
    if (state.profiles.length >= 25 && !state.profiles.some((item) => item.id === profile.id)) throw new Error("Local profile limit reached");
    state.profiles = [...state.profiles.filter((item) => item.id !== profile.id), profile];
    return profile;
  });
}

export async function deleteProfile(id: string) {
  return withState(async (state) => {
    state.profiles = state.profiles.filter((profile) => profile.id !== id);
    state.briefings = state.briefings.filter((briefing) => briefing.profileId !== id);
  });
}

export async function prepareProfile(id: string, refresh = false, now = new Date()) {
  return withState(async (state) => {
    const profile = state.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profile not found");
    const fingerprint = profileFingerprint(profile), date = localClock(profile.timezone, now).date;
    if (!profile.consentToPersonalization) throw new Error("Personalization consent is required");
    const cached = state.briefings.find((briefing) => briefing.profileId === id && briefing.localDate === date && briefing.profileFingerprint === fingerprint);
    if (cached && !refresh) return cached;
    const apiKey = requireSecret("OPENAI_API_KEY");
    const briefing = await prepareBriefing(profile, fingerprint, (query, correlation, domains) => searchLiveWeb(query, correlation, apiKey, domains), now, state.briefings);
    // A refresh retains old snapshots so a reviewed call cannot silently change its evidence.
    state.briefings = [briefing, ...state.briefings].filter((item, index, all) => all.slice(0, index).filter((other) => other.profileId === item.profileId).length < 14);
    return briefing;
  });
}

export async function resolveBriefingTask(id: string, now = new Date()) {
  const state = await readBriefingState();
  const briefing = state.briefings.find((item) => item.id === id);
  const profile = state.profiles.find((item) => item.id === briefing?.profileId);
  if (!briefing || !profile || briefing.profileFingerprint !== profileFingerprint(profile)) throw new Error("Briefing is missing or profile changed; prepare and review again");
  return renderBriefingTask(briefing, profile, now);
}

export async function prepareSharedBriefing(refresh = false, now = new Date()) {
  await saveProfile(SHARED_BRIEFING_PROFILE);
  return prepareProfile(SHARED_BRIEFING_PROFILE.id, refresh, now);
}

export async function prepareDueBriefings(now = new Date()) {
  const { profiles } = await readBriefingState();
  for (const profile of profiles) {
    if (!profile.autoPrepare || !profile.consentToPersonalization || localClock(profile.timezone, now).time < profile.prepareAt) continue;
    await prepareProfile(profile.id, false, now);
  }
}
