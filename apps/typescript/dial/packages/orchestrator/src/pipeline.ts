import { eq, and, or, isNull, isNotNull, desc, sql } from 'drizzle-orm';
import {
  tasks,
  calls,
  callAttempts,
  businessCandidates,
  taskEvents,
  authorizationRequests,
  contacts,
  enqueueJob,
  type Db,
} from '@dial/database';
import {
  getCallFamily,
  describeCalleError,
  dialTaskSchema,
  isTerminalTaskState,
  type CallFamilyId,
  type DialTask,
  type TaskState,
  type CallDisposition,
  type TaskResult,
  type BusinessCandidate,
} from '@dial/schemas';
import {
  rankCandidates,
  selectCallTargets,
  compareOutcomes,
  canPlaceCalls,
  canPerformSideEffect,
  isUnsupportedSensitivity,
  isValidE164,
  isBlockedNumber,
  shouldAskClarification,
  extractDialTargets,
  normalizePhone,
  primaryLanguageForCountry,
  normalizeLanguageCode,
  languageOptions,
  describeLanguage,
  englishNameOf,
} from '@dial/domain';
import {
  buildCallBrief,
  callIdempotencyKey,
  unresolvedFields,
  ProviderError,
  isTerminal,
} from '@dial/calle';
import {
  isTooCoarseToSearch,
  isCountryLevel,
  cityFromTimezone,
  type GeocodeResult,
} from '@dial/search';
import { logger, incrementCounter, observe } from '@dial/observability';
import type { OrchestratorContext } from './context.js';
import {
  setState,
  addEvent,
  getTask,
  isTaskPaused,
  saveCandidates,
  listCandidates,
  listCalls,
  markSelected,
  getUserPolicy,
  getSettings,
  newId,
  notify,
  audit,
  reserveCallBudget,
  releaseCallBudget,
  rowToCandidate,
} from './repo.js';
import { InterpreterUnavailableError } from '@dial/ai';

/**
 * The task pipeline. Each step is a durable job: it reads the task's current
 * state from the database, does one thing, records the outcome, and schedules
 * whatever comes next. Nothing is held in memory between steps, so a worker
 * restart resumes rather than loses -- and because dispatch is guarded by a
 * unique idempotency key, a redelivered job cannot dial twice.
 */

/* ------------------------------------------------------------- interpret */

export async function handleInterpret(
  ctx: OrchestratorContext,
  payload: { taskId: string },
): Promise<void> {
  /*
   * Paused: put this step back rather than dropping it.
   *
   * These are the linear steps -- nothing else re-triggers them, so returning
   * without rescheduling would leave a resumed task stuck at whichever stage
   * it happened to be paused in. Deferring costs one cheap row every half
   * minute and needs no special case on the way back.
   */
  if (await isTaskPaused(ctx.db, payload.taskId)) {
    await enqueueJob(ctx.db, 'task.interpret', payload, {
      runAt: new Date(Date.now() + PAUSED_RECHECK_MS),
      dedupeKey: `interpret:${payload.taskId}:${Date.now()}`,
    });
    return;
  }

  const task = await getTask(ctx.db, payload.taskId);
  // `interpreting` is a valid entry state as well as `created`: it means a
  // previous attempt began and did not finish, which is exactly the case a
  // queue retry is for. Re-entering is safe because this handler only reads the
  // instruction and overwrites its own output.
  if (!task || (task.state !== 'created' && task.state !== 'interpreting')) return;

  if (task.state === 'created') await setState(ctx, task.id, 'interpreting');

  if (!ctx.interpreter) {
    await failTask(
      ctx,
      task.id,
      'llm_not_configured',
      new InterpreterUnavailableError().message,
    );
    return;
  }

  const settings = await getSettings(ctx.db, task.userId);
  const now = new Date();

  let interpreted: { task: DialTask; callFamily: CallFamilyId };
  try {
    interpreted = await ctx.interpreter.interpret({
      instruction: task.instruction,
      locationLabel: task.locationLabel ?? settings.defaultLocation?.label ?? null,
      today: now.toISOString().slice(0, 10),
      currentTime: now.toTimeString().slice(0, 5),
      knownPreferences: {},
    });
  } catch (error) {
    // A busy or rate-limited model is temporary. Throwing hands the job back to
    // the queue, which retries with exponential backoff — the user waits rather
    // than being told their request failed. Only an exhausted job becomes a
    // terminal failure, and the runner handles that.
    if ((error as { retryable?: boolean }).retryable) {
      await addEvent(
        ctx,
        task.id,
        'interpreting',
        'Still working — Dial is waiting on a busy service and will retry shortly.',
      );
      incrementCounter('task.interpret_retry');
      throw error;
    }
    // Permanent. The message is one of ours; provider text never reaches here.
    await failTask(ctx, task.id, 'interpretation_failed', (error as Error).message);
    return;
  }

  const dialTask = interpreted.task;

  // Safety gates, evaluated before anything is stored as actionable.
  /*
   * The premise, checked before the mechanics.
   *
   * Asked to find dinosaur meat in Dubai, every stage behaved correctly: the
   * request parsed, four clarifying questions were asked about it, ninety-one
   * butchers were discovered, and Dial started telephoning them. Nothing was
   * broken except that nobody had asked whether the thing exists.
   *
   * First, so no question is asked and no number is dialled about something
   * that cannot be found. The interpreter's own sentence is what the user
   * reads -- it explains the specific request rather than refusing generically.
   */
  if (dialTask.impossibleReason) {
    await failTask(ctx, task.id, 'impossible_request', dialTask.impossibleReason);
    return;
  }
  if (dialTask.isEmergency) {
    await failTask(
      ctx,
      task.id,
      'emergency',
      'This looks like an emergency. Please contact your local emergency services directly — Dial must not sit between you and them.',
    );
    return;
  }
  if (isUnsupportedSensitivity(dialTask)) {
    await failTask(
      ctx,
      task.id,
      'unsupported',
      'Dial will not handle this kind of request by automated phone call.',
    );
    return;
  }
  if (dialTask.authorizationRequirement === 'not_supported') {
    await failTask(
      ctx,
      task.id,
      'unsupported',
      'This request needs to be handled by you directly rather than by an automated call.',
    );
    return;
  }

  // Answers to the intake questions become task constraints, so they reach both
  // the ranking layer and the call brief.
  const answers = (task.clarifyingAnswers ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(answers)) {
    // The language answer routes calls, it is not a requirement to state at
    // businesses -- folding it into the brief produced lines like
    // "call language: Arabic" that the agent had to silently ignore.
    if (key === CALL_LANGUAGE_QUESTION_ID) continue;
    if (typeof value === 'string' && value.trim()) {
      dialTask.constraints.additional[key] = value.trim();
    }
  }

  // An answer naming a place has to actually move the search, not just sit in
  // the constraints. Asking "which city in Saudi Arabia?", being told "Riyadh",
  // and then still searching the whole country is the obvious failure here.
  const answeredPlace = placeFromAnswers(answers);
  if (answeredPlace) {
    const original = dialTask.location?.raw ?? null;
    // Keep the broader place for context: "Riyadh" alone is ambiguous
    // worldwide, "Riyadh, Saudi Arabia" is not.
    const combined =
      original && !answeredPlace.toLowerCase().includes(original.toLowerCase())
        ? `${answeredPlace}, ${original}`
        : answeredPlace;

    dialTask.location = {
      raw: combined,
      latitude: null,
      longitude: null,
      label: null,
      radiusKm: dialTask.location?.radiusKm ?? null,
    };
    logger.info('intake answer narrowed the search location', { taskId: task.id, to: combined });
  }

  await ctx.db
    .update(tasks)
    .set({
      interpreted: dialTask,
      callFamily: interpreted.callFamily,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tasks.id, task.id));

  /*
   * A number in the request answers the question the search stage exists to
   * answer. Read from the instruction in code rather than from the model: a
   * phone number is a precisely specified pattern with a library that validates
   * it, where a model would occasionally hand back a price or an order number
   * and Dial would ring it.
   */
  const hintCountry = await recentCountryFor(ctx.db, task.userId);
  const [target] = extractDialTargets(task.instruction, hintCountry);
  let directPhone = target?.e164 ?? null;

  /*
   * "Call Malik" names who to ring, not a kind of business to look for. Without
   * this, Malik is treated as a search term and the user is asked which city to
   * search for him in -- a question that cannot have a useful answer.
   */
  if (!directPhone && dialTask.calleeName) {
    const known = await findContactByName(ctx.db, task.userId, dialTask.calleeName);
    if (known) {
      directPhone = known.phoneE164;
    } else {
      // Dial has no number for this person, and no amount of searching would
      // find one. Say so, rather than asking where to look.
      await setState(
        ctx,
        task.id,
        'needs_user_input',
        `Dial does not have a number for ${dialTask.calleeName}.`,
        {
          clarificationQuestion:
            `Dial does not have a number for ${dialTask.calleeName}. ` +
            'Add them to your contacts, or include the number in your request.',
        },
      );
      incrementCounter('task.unknown_callee');
      return;
    }
  }

  /*
   * Dial knows who to ring but not what to say.
   *
   * A search carries its own purpose -- "the cheapest screen repair" is both
   * who to call and what to ask. "Call Malik" is only the first half, and a
   * call placed on that would open with nothing to say to whoever answers.
   *
   * An unclear answer earns another question rather than a shrug, because the
   * alternative is ringing a real person with no idea what for. Bounded, so a
   * user who cannot say what they want is eventually let go rather than held in
   * a loop.
   */
  if (directPhone && !dialTask.callPurpose) {
    if (task.purposeAsks < MAX_PURPOSE_ASKS) {
      const who = dialTask.calleeName ?? 'them';
      const again = task.purposeAsks > 0;
      await ctx.db
        .update(tasks)
        .set({ purposeAsks: task.purposeAsks + 1 })
        .where(eq(tasks.id, task.id));
      await setState(ctx, task.id, 'needs_user_input', `What should Dial ask ${who}?`, {
        clarificationQuestion: again
          ? `Dial still is not sure what to ask ${who}. What should it say when they answer?`
          : `What do you want from ${who}?`,
      });
      incrementCounter('task.purpose_asked', { repeat: String(again) });
      return;
    }
    // Asked enough. Going ahead with a vague brief is more honest than holding
    // the task hostage to a question the user is not going to answer.
    logger.info('proceeding without a stated purpose', {
      taskId: task.id,
      asks: task.purposeAsks,
    });
    await addEvent(
      ctx,
      task.id,
      'interpreting',
      'Dial will keep the call general, since it is not sure what to ask.',
    );
  }

  if (directPhone) {
    await ctx.db.update(tasks).set({ directPhone }).where(eq(tasks.id, task.id));
    logger.info('the request named who to call, so nothing needs finding', {
      taskId: task.id,
      via: target ? 'number' : 'contact',
    });
  }

  // The intake step: a few targeted questions asked once, before any work.
  // Distinct from the model interrupting mid-pipeline, which is suppressed
  // below -- these are generated deliberately, capped, and skippable.
  // Intake questions exist to sharpen a search -- which shop, what model, how
  // soon. None of that applies when the request already said who to ring, and
  // asking anyway is the friction the whole direct-dial path avoids.
  if (!directPhone && !task.intakeDone && settings.askClarifyingQuestions && ctx.questionGenerator) {
    const questions = await ctx.questionGenerator
      .generate({ instruction: task.instruction, task: dialTask })
      .catch(() => []);

    // Intake is an enhancement. If it produced nothing, carry on rather than
    // blocking the task on a step that is meant to help.
    if (questions.length > 0) {
      await ctx.db
        .update(tasks)
        .set({ clarifyingQuestions: questions, intakeDone: true })
        .where(eq(tasks.id, task.id));

      await setState(
        ctx,
        task.id,
        'needs_user_input',
        `A few quick questions so Dial asks the right things (${questions.length})`,
      );
      return;
    }
    await ctx.db.update(tasks).set({ intakeDone: true }).where(eq(tasks.id, task.id));
  }

  // Only interrupt when the task genuinely cannot proceed. The model's opinion
  // that a question would be nice is not sufficient -- see shouldAskClarification.
  // A named number settles the commonest thing it asks about, so it is ignored.
  if (!directPhone && dialTask.clarificationNeeded && shouldAskClarification(dialTask)) {
    await setState(ctx, task.id, 'needs_user_input', dialTask.clarificationNeeded, {
      clarificationQuestion: dialTask.clarificationNeeded,
    });
    return;
  }
  if (dialTask.clarificationNeeded) {
    logger.info('ignoring an unnecessary clarification request', {
      taskId: task.id,
      question: dialTask.clarificationNeeded,
    });
  }

  await enqueueJob(ctx.db, 'task.research', { taskId: task.id }, { dedupeKey: `research:${task.id}`, maxAttempts: 8 });
}

/**
 * Turns a country-sized match into somewhere Dial can actually search.
 *
 * Three sources, cheapest first, because the first two need no second service
 * and the public Overpass instances rate-limit aggressively:
 *
 *  1. The capital, when OpenStreetMap tags one on the country (`capital_city`).
 *     Already in the geocode response, so it is free.
 *  2. The city the IANA timezone is named after ('Asia/Riyadh' -> Riyadh).
 *     Also already in the response, and present for most countries that have a
 *     single zone.
 *  3. The largest city by population inside the country's bounding box, via
 *     Overpass. Slower and less reliable, but it is the only one of the three
 *     that works for a country the geocoder has neither tag for -- Finland and
 *     Morocco both have neither.
 *
 * Returns null when none can answer, which is the only case where the user has
 * to be asked.
 */
async function resolveSearchableCity(
  ctx: OrchestratorContext,
  countryGeo: GeocodeResult,
  countryName: string,
): Promise<{ name: string; latitude: number; longitude: number } | null> {
  const hints = [countryGeo.capitalCity, cityFromTimezone(countryGeo.timezone)].filter(
    (h): h is string => Boolean(h && h.trim()),
  );

  for (const hinted of hints) {
    // Geocode the hint rather than trusting it as a place: this confirms the
    // city exists and is in the right country.
    const city = await ctx.discovery.geocode(`${hinted}, ${countryName}`).catch(() => null);
    if (!city) continue;
    // `isCountryLevel`, not `isTooCoarseToSearch`: the coordinate here is the
    // city's own place node, so the width of the administrative area around it
    // is beside the point. See the note on that function.
    if (isCountryLevel(city)) continue;
    if (countryGeo.countryCode && city.countryCode !== countryGeo.countryCode) continue;
    // Show the geocoder's name for it, not the tag's: OSM stores `capital_city`
    // in the local script, so Egypt's arrives as "القاهرة" while the geocoded
    // label -- requested in English -- says Cairo.
    const name = city.label.split(',')[0]?.trim() || hinted;
    return { name, latitude: city.latitude, longitude: city.longitude };
  }

  const largest = await ctx.discovery
    .findMajorCity(countryGeo.countryCode, countryGeo.boundingBox ?? null)
    .catch(() => null);
  return largest
    ? { name: largest.name, latitude: largest.latitude, longitude: largest.longitude }
    : null;
}

/**
 * Is this "location" actually a reference to the user's own position rather
 * than a place that can be looked up?
 *
 * Matters because the two need opposite handling: a real place name that fails
 * to geocode is a transient service problem worth retrying, while "near me"
 * with no coordinates on file can only be resolved by asking.
 */
export function isRelativeLocation(raw: string): boolean {
  return /^(near ?me|nearby|near by|close by|around here|my area|my location|here|local|locally|in my area)$/i.test(
    raw.trim(),
  );
}

/**
 * Picks the answer that names a place, if the intake asked for one.
 *
 * Matched on the question id rather than the text, because the id is the
 * snake_case key the generator chose and is stable across languages. Exported
 * for testing.
 */
export function placeFromAnswers(answers: Record<string, string>): string | null {
  const looksLikePlace = /(^|_)(city|town|area|district|neighbourhood|neighborhood|location|region|emirate|governorate|postcode|zip)(_|$)/;

  for (const [key, value] of Object.entries(answers)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    // A non-answer must not be geocoded — "anywhere" is not a place.
    if (/^(any|anywhere|no preference|doesn'?t matter|not sure|n\/a)$/i.test(trimmed)) continue;
    if (looksLikePlace.test(key.toLowerCase())) return trimmed;
  }
  return null;
}

/**
 * The id of the language question, shared with the endpoint that receives the
 * answer so neither side has to guess the other's spelling.
 */
export const CALL_LANGUAGE_QUESTION_ID = 'call_language';

/**
 * Below this many callable businesses, the first search is not worth acting on
 * and it is cheaper to widen than to ring the one shop that listed a number.
 */
const MIN_CALLABLE_BEFORE_WIDENING = 3;

/**
 * How many times Dial asks what a direct call is for before giving up and
 * keeping the call general. Two questions is persistence; five is an argument.
 */
const MAX_PURPOSE_ASKS = 2;

/**
 * Rings a number the user supplied, skipping discovery entirely.
 *
 * There is nothing to find, nowhere to search, and no location to ask about.
 * The number still goes through the same ranking and calling path as a
 * discovered business, so the policy gates, the daily budget, the blocked-number
 * check and the evidence trail all apply exactly as they otherwise would.
 */
async function dialTheNumberGiven(
  ctx: OrchestratorContext,
  task: { id: string; userId: string; directPhone: string | null; instruction: string },
  dialTask: DialTask,
): Promise<void> {
  const phone = task.directPhone!;
  const country = phoneCountryOf(phone);

  await setState(ctx, task.id, 'researching', 'Using the number you gave');

  const candidate: BusinessCandidate = {
    id: `given_${phone.replace(/[^0-9]/g, '')}`,
    // Named for what it is. Inventing a business name for a number nobody
    // looked up would be presenting a guess as a fact.
    name: (await contactNameFor(ctx.db, task.userId, phone)) ?? 'The number you gave',
    category: null,
    address: null,
    latitude: null,
    longitude: null,
    phoneE164: phone,
    phoneRaw: phone,
    website: null,
    source: 'user_supplied',
    sourceUrl: null,
    rating: null,
    reviewCount: null,
    distanceMeters: null,
    openingHours: null,
    // The user gave it, which is a stronger warrant than any directory.
    phoneVerified: true,
    verificationSources: [],
  };

  const ranked = rankCandidates([candidate], { task: dialTask });
  await saveCandidates(ctx.db, task.id, ranked);
  await ctx.db
    .update(tasks)
    .set({ discoveredCount: 1, countryCode: country })
    .where(eq(tasks.id, task.id));

  await setState(ctx, task.id, 'candidates_ready', 'Calling the number you gave');

  const settings = await getSettings(ctx.db, task.userId);
  if (await askCallLanguage(ctx, task.id, country, null, settings.callingLanguage)) return;

  await enqueueJob(ctx.db, 'task.plan_calls', { taskId: task.id }, { dedupeKey: `plan:${task.id}` });
}

/** The country a number belongs to, for the language recommendation. */
function phoneCountryOf(phoneE164: string): string | null {
  const normalized = normalizePhone(phoneE164, null);
  return normalized?.country ?? null;
}

/**
 * Finds a saved contact by the name the user used.
 *
 * Matched case-insensitively, and on the longest name first: somebody with
 * both "Malik" and "Malik at the garage" saved means the more specific one
 * wins when the request mentions it, rather than whichever the database
 * happened to return first.
 */
async function findContactByName(
  db: Db,
  userId: string,
  name: string,
): Promise<{ phoneE164: string; name: string } | null> {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;

  const rows = await db
    .select({ name: contacts.name, phoneE164: contacts.phoneE164 })
    .from(contacts)
    .where(eq(contacts.userId, userId));

  const byLength = [...rows].sort((a, b) => b.name.length - a.name.length);
  return (
    byLength.find((c) => c.name.toLowerCase() === wanted) ??
    byLength.find((c) => {
      const candidateName = c.name.toLowerCase();
      return candidateName.includes(wanted) || wanted.includes(candidateName);
    }) ??
    null
  );
}

/** What the user already calls this number, if they have saved it. */
async function contactNameFor(db: Db, userId: string, phoneE164: string): Promise<string | null> {
  const rows = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.phoneE164, phoneE164)))
    .limit(1);
  return rows[0]?.name ?? null;
}

/**
 * The country of the user's most recent search, used only to read a number
 * written in national form. Someone who types "055 550 1234" means a local
 * number, and the last place they searched is the best evidence of where local
 * is. International form needs no hint and never consults this.
 */
async function recentCountryFor(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ countryCode: tasks.countryCode })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNotNull(tasks.countryCode)))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  return rows[0]?.countryCode ?? null;
}
export { recentCountryFor };

/* -------------------------------------------------------------- research */

export async function handleResearch(
  ctx: OrchestratorContext,
  payload: { taskId: string },
): Promise<void> {
  /*
   * Paused: put this step back rather than dropping it.
   *
   * These are the linear steps -- nothing else re-triggers them, so returning
   * without rescheduling would leave a resumed task stuck at whichever stage
   * it happened to be paused in. Deferring costs one cheap row every half
   * minute and needs no special case on the way back.
   */
  if (await isTaskPaused(ctx.db, payload.taskId)) {
    await enqueueJob(ctx.db, 'task.research', payload, {
      runAt: new Date(Date.now() + PAUSED_RECHECK_MS),
      dedupeKey: `research:${payload.taskId}:${Date.now()}`,
    });
    return;
  }

  const task = await getTask(ctx.db, payload.taskId);
  // A canceled or finished task must not keep working its way through the
  // pipeline: jobs are already queued when the user cancels, and discovery,
  // planning and dispatch would otherwise run to completion — dialling real
  // phones for a request the user withdrew.
  if (!task || isTerminalTaskState(task.state as TaskState)) return;
  const parsed = dialTaskSchema.safeParse(task.interpreted);
  if (!parsed.success) return;
  const dialTask = parsed.data;

  if (task.directPhone) {
    await dialTheNumberGiven(ctx, task, dialTask);
    return;
  }

  await setState(ctx, task.id, 'researching');

  // Resolve location: explicit task coords -> user default -> geocoded text.
  const settings = await getSettings(ctx.db, task.userId);
  let latitude = task.latitude ?? settings.defaultLocation?.latitude ?? null;
  let longitude = task.longitude ?? settings.defaultLocation?.longitude ?? null;
  let locationLabel = task.locationLabel ?? settings.defaultLocation?.label ?? null;
  let countryCode: string | null = null;

  // "near me" is not a place, it is a reference to coordinates we do not have.
  // Geocoding it would fail forever, so it counts as no location at all and the
  // user is asked — unlike a real place name, which is retried.
  const rawPlace = dialTask.location?.raw ?? null;
  const requestedPlace = rawPlace && !isRelativeLocation(rawPlace) ? rawPlace : null;

  if ((latitude === null || longitude === null) && requestedPlace) {
    let geo;
    try {
      geo = await ctx.discovery.geocode(requestedPlace);
    } catch (error) {
      // The geocoder being down is not the same as the user not telling us
      // where. Retry rather than asking them to repeat themselves.
      logger.warn('geocoding threw', {
        taskId: task.id,
        place: requestedPlace,
        error: (error as Error).message,
      });
      geo = null;
    }

    if (!geo) {
      // Same reasoning: they said "Dubai". Asking "where should Dial search?"
      // in response to a transient lookup failure is the worst possible reply.
      await addEvent(
        ctx,
        task.id,
        'researching',
        `Still finding ${requestedPlace} on the map — Dial will try again shortly.`,
      );
      incrementCounter('task.geocode_retry');
      const error = new Error('Geocoding unavailable') as Error & { retryable: boolean };
      error.retryable = true;
      throw error;
    }

    // A country or region is too big to search around a centroid, but that is
    // no reason to stop and ask. Start from its largest city and say so.
    if (isTooCoarseToSearch(geo)) {
      const placeName = geo.label.split(',')[0]?.trim() || requestedPlace;
      const resolved = await resolveSearchableCity(ctx, geo, placeName);

      if (resolved) {
        latitude = resolved.latitude;
        longitude = resolved.longitude;
        locationLabel = `${resolved.name}, ${placeName}`;
        countryCode = geo.countryCode;
        await addEvent(
          ctx,
          task.id,
          'researching',
          `${placeName} is a whole country — Dial searched ${resolved.name}. Name a different city if you would rather.`,
        );
      } else {
        // Could not resolve a city, so there is genuinely nothing to search
        // around. This is the one case where asking is the only option.
        await setState(
          ctx,
          task.id,
          'needs_user_input',
          `${placeName} covers too large an area for Dial to search.`,
          {
            latitude: null,
            longitude: null,
            clarificationQuestion: `Which town or city in ${placeName} should Dial search?`,
          },
        );
        return;
      }
    } else {
      latitude = geo.latitude;
      longitude = geo.longitude;
      locationLabel = geo.label;
      countryCode = geo.countryCode;
    }
  }
  if (latitude === null || longitude === null) {
    await setState(
      ctx,
      task.id,
      'needs_user_input',
      'Dial needs to know roughly where you are to find nearby businesses.',
      { clarificationQuestion: 'Where should Dial search? A city, area or postcode is enough.' },
    );
    return;
  }
  if (!countryCode && latitude !== null && longitude !== null) {
    const reverse = await ctx.discovery.reverseGeocode(latitude, longitude);
    if (reverse) {
      countryCode = reverse.countryCode;
      locationLabel ??= reverse.label;
    }
  }

  await ctx.db
    .update(tasks)
    .set({ latitude, longitude, locationLabel, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, task.id));

  const radiusKm = dialTask.constraints.distanceKm ?? dialTask.location?.radiusKm ?? 10;

  let outcome = await ctx.discovery.discover({
    query: dialTask.searchQuery,
    domain: dialTask.domain,
    latitude,
    longitude,
    radiusMeters: radiusKm * 1000,
    limit: 20,
    countryCode,
  });

  // Widen when the first pass produced too little to compare with.
  //
  // The measure is *callable* businesses, not businesses found: directory phone
  // coverage varies enormously by region. A search of Riyadh returned 14 repair
  // shops of which exactly one published a number, while Jeddah returned 49 with
  // seven. Finding fourteen shops and being able to ring one of them is not a
  // useful answer, and one extra directory query is far cheaper than a thin one.
  const countCallable = (list: typeof outcome.candidates) => list.filter((c) => c.phoneE164).length;
  const widenedKm = Math.min(radiusKm * 4, 50);

  if (countCallable(outcome.candidates) < MIN_CALLABLE_BEFORE_WIDENING && widenedKm > radiusKm) {
    const found = outcome.candidates.length;
    await addEvent(
      ctx,
      task.id,
      'researching',
      found === 0
        ? `Nothing within ${radiusKm} km — widening the search to ${widenedKm} km`
        : `Only ${countCallable(outcome.candidates)} of ${found} nearby businesses list a phone number — widening the search to ${widenedKm} km`,
    );

    const wider = await ctx.discovery.discover({
      query: dialTask.searchQuery,
      domain: dialTask.domain,
      latitude,
      longitude,
      radiusMeters: widenedKm * 1000,
      limit: 30,
      countryCode,
    });

    // Keep whichever pass produced more to work with. A wider search that hit a
    // provider error must not throw away results the first pass already had.
    if (countCallable(wider.candidates) >= countCallable(outcome.candidates) && wider.candidates.length > 0) {
      outcome = wider;
    }
  }

  if (outcome.candidates.length === 0) {
    // A provider outage and a genuinely empty area are different stories.
    if (outcome.providerErrors.length) {
      // A timeout or rate limit is temporary. Hand the job back to the queue so
      // it retries with backoff, exactly as a busy model does, rather than
      // ending the task on a blip.
      if (outcome.providerErrors.some((e) => e.retryable)) {
        await addEvent(
          ctx,
          task.id,
          'researching',
          'The business directory is slow right now — Dial will try again shortly.',
        );
        incrementCounter('task.research_retry');
        const error = new Error('Business directory unavailable') as Error & { retryable: boolean };
        error.retryable = true;
        throw error;
      }
      await failTask(
        ctx,
        task.id,
        'search_unavailable',
        'Dial could not reach the business directory just now. Please try again shortly.',
      );
    } else {
      await failTask(
        ctx,
        task.id,
        'no_businesses',
        `Dial could not find any ${dialTask.searchQuery} near ${locationLabel ?? 'that location'}.`,
      );
    }
    return;
  }

  const ranked = rankCandidates(outcome.candidates, { task: dialTask });
  await saveCandidates(ctx.db, task.id, ranked);

  const callable = ranked.filter((r) => !r.excludedReason).length;
  await ctx.db
    .update(tasks)
    .set({ discoveredCount: outcome.candidates.length, countryCode })
    .where(eq(tasks.id, task.id));

  await setState(
    ctx,
    task.id,
    'candidates_ready',
    `${outcome.candidates.length} ${outcome.candidates.length === 1 ? 'business' : 'businesses'} found`,
  );

  if (callable === 0) {
    await failTask(
      ctx,
      task.id,
      'no_phone_numbers',
      `Dial found ${outcome.candidates.length} nearby businesses, but none published a phone number it could verify.`,
    );
    return;
  }

  // Which language to speak, asked now because this is the first moment the
  // country is known and there is something worth calling.
  if (await askCallLanguage(ctx, task.id, countryCode, task.callLanguage, settings.callingLanguage)) {
    return;
  }

  await enqueueJob(ctx.db, 'task.plan_calls', { taskId: task.id }, { dedupeKey: `plan:${task.id}` });
}

/**
 * Offers the language for this task's calls, the country's own language first.
 *
 * Only asked when there is something to decide. If the user's saved language is
 * already the one spoken where Dial is calling, the answer is not in doubt and
 * a question would be pure friction -- Dial says which language it will use and
 * gets on with it.
 *
 * Returns true when the task has been parked on the question.
 */
async function askCallLanguage(
  ctx: OrchestratorContext,
  taskId: string,
  countryCode: string | null,
  alreadyChosen: string | null,
  savedLanguage: string,
): Promise<boolean> {
  if (alreadyChosen) return false;

  const primary = primaryLanguageForCountry(countryCode);
  const saved = normalizeLanguageCode(savedLanguage) ?? 'en';

  // Nothing to weigh up: the saved language is the local one, or the country is
  // unknown so there is no recommendation to offer.
  if (!primary || primary === saved) {
    if (primary) {
      await addEvent(
        ctx,
        taskId,
        'candidates_ready',
        `Calling in ${englishNameOf(primary)}.`,
      );
    }
    return false;
  }

  const options = languageOptions(countryCode, [saved]);
  const recommended = options.find((o) => o.recommended) ?? options[0]!;

  await ctx.db
    .update(tasks)
    .set({
      clarifyingQuestions: [
        {
          id: CALL_LANGUAGE_QUESTION_ID,
          question: 'Which language should Dial speak on these calls?',
          why: `${englishNameOf(primary)} is the main language where Dial is calling.`,
          options: options.map(describeLanguage),
          required: false,
        },
      ],
    })
    .where(eq(tasks.id, taskId));

  await setState(
    ctx,
    taskId,
    'needs_user_input',
    `Which language should Dial speak? ${describeLanguage(recommended)}`,
  );
  incrementCounter('task.call_language_asked');
  return true;
}

/* ------------------------------------------------------------ plan calls */

export async function handlePlanCalls(
  ctx: OrchestratorContext,
  payload: { taskId: string },
): Promise<void> {
  /*
   * Paused: put this step back rather than dropping it.
   *
   * These are the linear steps -- nothing else re-triggers them, so returning
   * without rescheduling would leave a resumed task stuck at whichever stage
   * it happened to be paused in. Deferring costs one cheap row every half
   * minute and needs no special case on the way back.
   */
  if (await isTaskPaused(ctx.db, payload.taskId)) {
    await enqueueJob(ctx.db, 'task.plan_calls', payload, {
      runAt: new Date(Date.now() + PAUSED_RECHECK_MS),
      dedupeKey: `plan:${payload.taskId}:${Date.now()}`,
    });
    return;
  }

  const task = await getTask(ctx.db, payload.taskId);
  // Same guard as research: a job queued before a cancellation must not plan,
  // reserve budget for, or dispatch calls on a task the user withdrew.
  if (!task || isTerminalTaskState(task.state as TaskState)) return;
  const parsed = dialTaskSchema.safeParse(task.interpreted);
  if (!parsed.success) return;
  const dialTask = parsed.data;

  await setState(ctx, task.id, 'planning_calls');

  const policy = await getUserPolicy(ctx.db, task.userId);

  // Gate 1: may Dial call at all?
  const callVerdict = canPlaceCalls({ policy, task: dialTask });
  if (!callVerdict.allowed) {
    await failTask(ctx, task.id, 'not_authorized', callVerdict.reason);
    return;
  }

  // Gate 2: may Dial perform the side effect this task implies?
  const sideEffect = canPerformSideEffect({ policy, task: dialTask });
  if (!sideEffect.allowed) {
    await failTask(ctx, task.id, 'not_authorized', sideEffect.reason);
    return;
  }

  // Anything needing confirmation stops here and asks, before a single call.
  if (callVerdict.requiresConfirmation || sideEffect.requiresConfirmation) {
    const existing = await ctx.db
      .select()
      .from(authorizationRequests)
      .where(
        and(eq(authorizationRequests.taskId, task.id), eq(authorizationRequests.state, 'approved')),
      )
      .limit(1);

    if (!existing.length) {
      await requestAuthorization(ctx, task.id, task.userId, {
        kind: sideEffect.requiresConfirmation ? sideEffect.kind : callVerdict.kind,
        prompt: sideEffect.requiresConfirmation ? sideEffect.reason : callVerdict.reason,
        details: { objective: dialTask.objective, sideEffect: dialTask.requestedSideEffect },
      });
      return;
    }
  }

  const ranked = await listCandidates(ctx.db, task.id);
  const targets = selectCallTargets(ranked, {
    maxCallsPerTask: ctx.config.limits.maxCallsPerTask,
    requested: dialTask.constraints.candidateLimit,
  });

  if (targets.length === 0) {
    await failTask(ctx, task.id, 'no_phone_numbers', 'No business had a usable phone number.');
    return;
  }

  // Section 27: daily ceiling, reserved atomically before any dispatch.
  const budget = await reserveCallBudget(
    ctx.db,
    task.userId,
    targets.length,
    ctx.config.limits.maxCallsPerUserPerDay,
  );
  if (budget.granted === 0) {
    await failTask(
      ctx,
      task.id,
      'daily_limit',
      "You've reached today's limit on calls Dial can place. It resets tomorrow.",
    );
    return;
  }

  const allowed = targets.slice(0, budget.granted);
  const waveSize = Math.max(1, Math.min(ctx.config.limits.callWaveSize, allowed.length));

  // Create the call rows up front, then dispatch in waves. The rows are the
  // record of intent; dispatch is what actually rings a phone.
  let wave = 1;
  let indexInWave = 0;
  for (const target of allowed) {
    const phone = target.candidate.phoneE164;
    if (!phone || !isValidE164(phone) || isBlockedNumber(phone)) continue;

    await ctx.db
      .insert(calls)
      .values({
        id: newId('call'),
        taskId: task.id,
        candidateId: target.candidate.id,
        businessName: target.candidate.name,
        phoneE164: phone,
        idempotencyKey: callIdempotencyKey(task.id, target.candidate.id, 1),
        disposition: 'pending',
        wave,
      })
      .onConflictDoNothing();

    indexInWave += 1;
    if (indexInWave >= waveSize) {
      wave += 1;
      indexInWave = 0;
    }
  }

  await markSelected(
    ctx.db,
    allowed.map((t) => t.candidate.id),
  );
  await audit(ctx.db, task.userId, task.id, 'calls_planned', { count: allowed.length });

  await enqueueJob(
    ctx.db,
    'task.dispatch_wave',
    { taskId: task.id, wave: 1 },
    { dedupeKey: `wave:${task.id}:1` },
  );
}

async function requestAuthorization(
  ctx: OrchestratorContext,
  taskId: string,
  userId: string,
  input: { kind: string; prompt: string; details: Record<string, unknown> },
): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  // One outstanding request per task. A retried plan job used to insert a
  // second pending row, and approving the first left the duplicate sitting
  // there forever, resurfacing in the UI as an approval that was never asked
  // for again.
  const existing = await ctx.db
    .select({ id: authorizationRequests.id })
    .from(authorizationRequests)
    .where(
      and(eq(authorizationRequests.taskId, taskId), eq(authorizationRequests.state, 'pending')),
    )
    .limit(1);

  if (existing[0]) {
    await ctx.db
      .update(authorizationRequests)
      .set({
        kind: input.kind,
        prompt: input.prompt,
        details: input.details,
        expiresAt,
      })
      .where(eq(authorizationRequests.id, existing[0].id));
  } else {
    await ctx.db.insert(authorizationRequests).values({
      id: newId('auth'),
      taskId,
      userId,
      kind: input.kind,
      prompt: input.prompt,
      details: input.details,
      state: 'pending',
      expiresAt,
    });
  }
  await setState(ctx, taskId, 'awaiting_confirmation', input.prompt);
  await notify(ctx, userId, taskId, 'Dial needs your approval', input.prompt);
}

/* --------------------------------------------------------- dispatch wave */

export async function handleDispatchWave(
  ctx: OrchestratorContext,
  payload: { taskId: string; wave: number },
): Promise<void> {
  /*
   * A wave job queued before the pause must not dial. Returning without
   * rescheduling is safe: resuming re-enters the pipeline through
   * maybeAdvance, which dispatches whatever is still outstanding.
   */
  if (await isTaskPaused(ctx.db, payload.taskId)) return;

  const task = await getTask(ctx.db, payload.taskId);
  // The last place a queued job can be stopped. Without this, a wave claimed
  // just before a cancellation rang real phones for a withdrawn task.
  if (!task || isTerminalTaskState(task.state as TaskState)) return;
  const parsed = dialTaskSchema.safeParse(task.interpreted);
  if (!parsed.success) return;
  const dialTask = parsed.data;

  const family = getCallFamily((task.callFamily as CallFamilyId) ?? 'general_inquiry');
  const policy = await getUserPolicy(ctx.db, task.userId);
  const settings = await getSettings(ctx.db, task.userId);

  // Only rows still awaiting dispatch. Filtering on disposition as well as the
  // missing provider id matters: compare marks never-needed rows `not_needed`
  // and cancel marks them off, and neither must ever be dialled by a wave job
  // that was already in flight when that happened.
  const pending = await ctx.db
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.taskId, task.id),
        eq(calls.wave, payload.wave),
        eq(calls.disposition, 'pending'),
        isNull(calls.providerCallId),
      ),
    );

  if (pending.length === 0) {
    await maybeAdvance(ctx, task.id);
    return;
  }

  await setState(ctx, task.id, 'calling', `Calling ${pending.length === 1 ? 'a business' : `${pending.length} businesses`}`);

  const mayCommit =
    dialTask.requestedSideEffect === 'reservation' || dialTask.requestedSideEffect === 'appointment';

  /*
   * What earlier calls on this task could not establish.
   *
   * Read once per wave rather than per call: every call in a wave goes out at
   * the same moment, so none of them can learn from the others, and querying
   * again inside the loop would return the same rows at extra cost. By the
   * next wave the results are in and the gap has narrowed.
   */
  const priorRows = await ctx.db
    .select({ structuredResult: calls.structuredResult })
    .from(calls)
    .where(and(eq(calls.taskId, task.id), eq(calls.disposition, 'answered_useful')));
  const unresolved = unresolvedFields(
    family,
    priorRows.map((row) => (row.structuredResult as Record<string, unknown> | null) ?? null),
  );

  for (const call of pending) {
    const candidateRows = await ctx.db
      .select()
      .from(businessCandidates)
      .where(eq(businessCandidates.id, call.candidateId))
      .limit(1);
    const candidateRow = candidateRows[0];
    if (!candidateRow) continue;

    const brief = buildCallBrief({
      task: dialTask,
      family,
      candidate: rowToCandidate(candidateRow),
      policy,
      mayCommit,
      userFacts: {},
      userDisplayName: null,
      unresolved,
    });

    try {
      const snapshot = await ctx.provider.create({
        task: brief,
        phone: call.phoneE164,
        resultSchema: family.resultSchema,
        metadata: { dial_task_id: task.id, dial_call_id: call.id },
        idempotencyKey: call.idempotencyKey,
        ...(ctx.config.calle.webhookUrl ? { webhookUrl: ctx.config.calle.webhookUrl } : {}),
        // What the user chose for this task, or their standing preference.
        locale: task.callLanguage ?? settings.callingLanguage,
      });

      await ctx.db
        .update(calls)
        .set({
          // Recorded per call, not read from config at render time, so a
          // simulated call stays identifiable as simulated forever.
          provider: ctx.provider.name,
          providerCallId: snapshot.providerCallId,
          providerStatus: snapshot.status,
          dispatchedAt: new Date().toISOString(),
          waitingSince: new Date().toISOString(),
          attemptCount: call.attemptCount + 1,
        })
        .where(eq(calls.id, call.id));

      incrementCounter('calls.dispatched', { provider: ctx.provider.name });
      await addEvent(ctx, task.id, 'calling', `Calling ${call.businessName}`);

      if (isTerminal(snapshot.status)) {
        // Some outcomes are known the moment the call is created — an invalid
        // number, a blocked recipient, or a provider that already has the
        // result. Waiting to poll for those would just delay the answer.
        await applyTerminalSnapshot(ctx, task.id, call.id, snapshot);
      } else {
        await enqueueJob(
          ctx.db,
          'task.poll_call',
          { taskId: task.id, callId: call.id },
          { runAt: new Date(Date.now() + ctx.config.limits.pollDelayMs), dedupeKey: `poll:${call.id}` },
        );
      }
    } catch (error) {
      await handleDispatchError(ctx, task.id, call.id, call.businessName, error);
    }
  }

  // Safety net: if every call somehow never reports back, finish anyway.
  await enqueueJob(
    ctx.db,
    'task.timeout',
    { taskId: task.id },
    {
      runAt: new Date(Date.now() + ctx.config.limits.stallTimeoutMs),
      dedupeKey: `timeout:${task.id}`,
    },
  );

  // Some or all of this wave may already be terminal (applied inline above, or
  // failed at dispatch). Advance now rather than waiting on a poll that will
  // never come.
  await maybeAdvance(ctx, task.id);
}

async function handleDispatchError(
  ctx: OrchestratorContext,
  taskId: string,
  callId: string,
  businessName: string,
  error: unknown,
): Promise<void> {
  const providerError = error instanceof ProviderError ? error : null;
  const code = providerError?.code ?? 'provider_unavailable';

  // Retryable errors are left for the job queue to redeliver.
  if (providerError?.retryable) throw error;

  await ctx.db
    .update(calls)
    .set({
      disposition: 'failed',
      failureCode: code,
      // Deliberately not passing the provider message as a fallback: an
      // unknown code would then put raw provider text in the UI.
      failureMessage: describeCalleError(code),
      completedAt: new Date().toISOString(),
    })
    .where(eq(calls.id, callId));

  incrementCounter('calls.dispatch_failed', { code });
  /*
   * The provider's own message is logged even though it is deliberately kept
   * out of the UI. Without it an unmapped code leaves nothing to go on: a call
   * failed with `call_not_ready`, the user was shown "The call could not be
   * completed", and working out what the service had actually objected to
   * meant probing the API by hand because the explanation had been discarded
   * at the only point it existed.
   */
  logger.warn('call dispatch failed', {
    taskId,
    callId,
    businessName,
    code,
    providerMessage: providerError?.message ?? (error as Error)?.message ?? null,
    mapped: describeCalleError(code) !== 'The call could not be completed.',
  });
  await addEvent(ctx, taskId, 'calling', `${businessName}: ${describeCalleError(code)}`);

  // Balance and auth failures affect every remaining call, so stop early
  // rather than burning through the list producing the same error.
  if (code === 'insufficient_balance' || code === 'unauthorized' || code === 'forbidden') {
    await failTask(ctx, taskId, code, describeCalleError(code));
  }
}

/* ------------------------------------------------------------- poll call */

/**
 * How far along a call is, as far as the provider will say.
 *
 * The distinction that matters is between waiting for a phone to be picked up
 * and waiting for a conversation to finish. Only the first is what the answer
 * budget is for; applying it to the second cuts off calls that are going fine.
 *
 * Read from the attempts rather than the call status, because the call-level
 * `in_progress` covers the whole job -- CALL-E's own queue and the dialling
 * included -- while an attempt distinguishes `dialing` from `in_progress`.
 * Transcript turns count as proof on their own: words were exchanged, so
 * somebody answered.
 */
export type CallPhase = 'queued' | 'ringing' | 'answered';

export function callPhase(snapshot: {
  status: string;
  attempts: Array<{ status: string; transcript: unknown[] }>;
}): CallPhase {
  const answered = snapshot.attempts.some(
    (a) => a.status === 'in_progress' || a.status === 'completed' || a.transcript.length > 0,
  );
  if (answered) return 'answered';
  // Still sitting in the provider's queue: nothing has rung yet, so none of
  // this time belongs to the answer budget.
  if (snapshot.status === 'queued') return 'queued';
  if (snapshot.attempts.some((a) => a.status === 'queued')) return 'queued';
  return 'ringing';
}

export async function handlePollCall(
  ctx: OrchestratorContext,
  payload: { taskId: string; callId: string },
): Promise<void> {
  const rows = await ctx.db.select().from(calls).where(eq(calls.id, payload.callId)).limit(1);
  const call = rows[0];
  if (!call || !call.providerCallId) return;

  // Stop watching once the task is over and this call is no longer pending:
  // a terminal task's finished calls need no more polls, and without this the
  // per-call poll chain ran forever. A call still pending on a terminal task
  // keeps being watched — it cannot be cancelled, so its real result is still
  // worth recording.
  const task = await getTask(ctx.db, payload.taskId);
  /*
   * Dial has stopped waiting on this call, but the provider has not been told
   * to stop -- CALL-E exposes no cancel. Both kinds of giving-up keep polling,
   * so a result that does arrive replaces the assumption rather than being
   * dropped on the floor.
   */
  const abandoned =
    call.failureCode === 'answer_timeout' || call.failureCode === 'provider_never_dialled';
  if (!task) return;
  if (
    isTerminalTaskState(task.state as TaskState) &&
    call.disposition !== 'pending' &&
    !abandoned
  ) {
    return;
  }
  if (call.disposition !== 'pending' && !abandoned) {
    await maybeAdvance(ctx, payload.taskId);
    return;
  }

  const snapshot = await ctx.provider.get(call.providerCallId);

  if (!isTerminal(snapshot.status)) {
    const phase = callPhase(snapshot);

    /*
     * The clock starts when the phone starts ringing, not when Dial handed the
     * call over.
     *
     * CALL-E queues before it dials, and that queue can outlast the whole
     * answer budget. Measured from dispatch, Dial gave up on five businesses
     * for "no answer" while every one of them was still waiting to be dialled
     * -- CALL-E then rang them, held a six-minute conversation with one, got a
     * price, and by then the call had been written off. Nothing rang, so none
     * of that time was the business failing to answer.
     */
    const stillQueued = phase === 'queued';
    const startedRinging = !stillQueued && call.providerStatus === 'queued';

    await ctx.db
      .update(calls)
      .set({
        providerStatus: snapshot.status,
        ...(startedRinging ? { waitingSince: new Date().toISOString() } : {}),
      })
      .where(eq(calls.id, call.id));

    /*
     * The queue has its own bound.
     *
     * The answer budget above deliberately does not run while a call is
     * queued -- CALL-E queues before it dials, and measuring from dispatch
     * once wrote off businesses that had never been rung. But nothing bounded
     * the queue either. A provider that accepts a call and never dials it left
     * the call pending until the task stalled out fifteen minutes later, and
     * the user was told "couldn't connect", which points at the business.
     *
     * The business did nothing. It was never called. That is what gets said.
     */
    if (stillQueued && call.dispatchedAt) {
      const queuedMs = Date.now() - new Date(call.dispatchedAt).getTime();
      if (queuedMs >= ctx.config.limits.queueTimeoutMs) {
        const minutes = Math.round(ctx.config.limits.queueTimeoutMs / 60_000);
        const abandonedQueue = await ctx.db
          .update(calls)
          .set({
            disposition: 'failed',
            failureCode: 'provider_never_dialled',
            failureMessage: `The calling service accepted this call but had not dialled it after ${minutes} minutes.`,
            completedAt: new Date().toISOString(),
          })
          .where(and(eq(calls.id, call.id), eq(calls.disposition, 'pending')))
          .returning({ id: calls.id });

        if (abandonedQueue.length > 0) {
          incrementCounter('calls.provider_never_dialled');
          logger.warn('provider held a call without dialling', {
            taskId: payload.taskId,
            callId: call.id,
            providerCallId: call.providerCallId,
            queuedMs,
          });
          await addEvent(
            ctx,
            payload.taskId,
            'calling',
            `${call.businessName}: the calling service never dialled — trying another business`,
          );
          await maybeAdvance(ctx, payload.taskId);
        }

        // Still worth watching: if the provider does dial eventually, the real
        // outcome replaces this one rather than being lost.
        await enqueueJob(ctx.db, 'task.poll_call', payload, {
          runAt: new Date(Date.now() + ctx.config.limits.pollDelayMs),
          dedupeKey: `poll:${call.id}:${Date.now()}`,
        });
        return;
      }
    }

    // How long the phone has been ringing, unanswered.
    const since = (startedRinging ? null : call.waitingSince) ?? call.dispatchedAt;
    const waitedMs = since && !startedRinging ? Date.now() - new Date(since).getTime() : 0;
    const budgetMs =
      ctx.config.limits.answerTimeoutMs * ctx.config.limits.maxAttemptsPerBusiness;

    /*
     * Never applied to a call that has been answered. The budget bounds how
     * long Dial waits for a pickup; a conversation in progress is the thing it
     * was waiting for, and cutting it off would discard the answer and report
     * "no answer" about a business that did answer.
     */
    if (phase !== 'answered' && !stillQueued && waitedMs >= budgetMs) {
      // Give up waiting and let another business have a turn.
      //
      // Note what this is NOT: CALL-E exposes no way to cancel a call in
      // flight, so the phone may still be ringing. Dial stops waiting; it
      // cannot stop the call. The wording reflects that.
      const marked = await ctx.db
        .update(calls)
        .set({
          disposition: 'no_answer',
          failureCode: 'answer_timeout',
          failureMessage: `No answer within ${Math.round(budgetMs / 1000)} seconds.`,
          completedAt: new Date().toISOString(),
        })
        .where(and(eq(calls.id, call.id), eq(calls.disposition, 'pending')))
        .returning({ id: calls.id });

      // The update only matches the first time. Without gating on it, every
      // later poll of an abandoned call re-announced "no answer" and inflated
      // the counter while the row had moved on already.
      if (marked.length > 0) {
        incrementCounter('calls.answer_timeout');
        await addEvent(
          ctx,
          payload.taskId,
          'calling',
          `${call.businessName}: no answer after ${Math.round(budgetMs / 1000)}s — trying another business`,
        );
        await maybeAdvance(ctx, payload.taskId);
      }
      // Keep watching anyway. Dial has moved on to another business, but the
      // phone may still be ringing and the result is worth having if it comes.
      await enqueueJob(
        ctx.db,
        'task.poll_call',
        payload,
        {
          runAt: new Date(Date.now() + ctx.config.limits.pollDelayMs),
          dedupeKey: `poll:${call.id}:${Date.now()}`,
        },
      );
      return;
    }

    await enqueueJob(
      ctx.db,
      'task.poll_call',
      payload,
      { runAt: new Date(Date.now() + ctx.config.limits.pollDelayMs), dedupeKey: `poll:${call.id}:${Date.now()}` },
    );
    return;
  }

  await applyTerminalSnapshot(ctx, payload.taskId, call.id, snapshot);
  await maybeAdvance(ctx, payload.taskId);
}

/**
 * Records a terminal call outcome. Shared by the poller and the webhook
 * receiver, so both paths produce identical rows and neither can double-apply.
 */
export async function applyTerminalSnapshot(
  ctx: OrchestratorContext,
  taskId: string,
  callId: string,
  snapshot: Awaited<ReturnType<OrchestratorContext['provider']['get']>>,
): Promise<void> {
  const task = await getTask(ctx.db, taskId);
  const family = getCallFamily((task?.callFamily as CallFamilyId) ?? 'general_inquiry');
  const settings = task ? await getSettings(ctx.db, task.userId) : null;

  const parsedResult = family.parse(snapshot.structuredResult);
  const disposition = deriveDisposition(
    snapshot,
    parsedResult,
    family.viabilityField,
    family.viabilityAsksWhetherAnswered ?? false,
  );

  const updated = await ctx.db
    .update(calls)
    .set({
      providerStatus: snapshot.status,
      disposition,
      structuredResult: parsedResult,
      summary: snapshot.summary,
      completionConfidence: snapshot.completionConfidence,
      taskCompleted: snapshot.taskCompleted,
      evidence: snapshot.evidence,
      failureCode: snapshot.failureCode,
      failureMessage: snapshot.failureMessage
        ? describeCalleError(snapshot.failureCode, snapshot.failureMessage)
        : null,
      startedAt: snapshot.attempts[0]?.startedAt ?? null,
      completedAt: snapshot.completedAt ?? new Date().toISOString(),
    })
    /*
     * Only a call still pending is updated, so a webhook and a poll racing each
     * other cannot both apply the result -- with one exception: a call Dial
     * stopped waiting for.
     *
     * CALL-E exposes no way to cancel a call in flight, so one abandoned on the
     * answer budget may still be connected, and may still come back with the
     * answer the whole task was for. Leaving the row saying "no answer" when a
     * price was quoted would be a lie Dial had the evidence to correct.
     */
    .where(
      and(
        eq(calls.id, callId),
        or(eq(calls.disposition, 'pending'), eq(calls.failureCode, 'answer_timeout')),
      ),
    )
    .returning({ id: calls.id, businessName: calls.businessName });

  if (!updated.length) return;

  for (const attempt of snapshot.attempts) {
    await ctx.db
      .insert(callAttempts)
      .values({
        id: newId('att'),
        callId,
        providerAttemptId: attempt.id,
        status: attempt.status,
        phoneMasked: attempt.phoneMasked,
        summary: attempt.summary,
        // Retention of 0 means the user asked Dial never to keep transcripts.
        transcript: settings?.transcriptRetentionDays === 0 ? [] : attempt.transcript,
        failureCode: attempt.failureCode,
        failureMessage: attempt.failureMessage,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
      })
      .onConflictDoNothing();
  }

  incrementCounter('calls.completed', { disposition });
  await addEvent(
    ctx,
    taskId,
    'collecting_results',
    `${updated[0]!.businessName}: ${dispositionLine(disposition)}`,
  );
}

function dispositionLine(disposition: CallDisposition): string {
  switch (disposition) {
    case 'answered_useful':
      return 'answered';
    case 'answered_no_answer_to_question':
      return "answered but couldn't say";
    case 'refused':
      return 'declined to answer';
    case 'no_answer':
      return 'no answer';
    case 'voicemail':
      return 'reached voicemail';
    case 'needs_review':
      return 'answer unclear';
    default:
      return "couldn't connect";
  }
}

/**
 * Section 13 / section 28: turning a call into a verdict.
 * The one rule that matters: a non-answer never becomes a positive answer.
 */
export function deriveDisposition(
  snapshot: { status: string; structuredResult: unknown; summary: string | null; failureCode: string | null },
  parsedResult: Record<string, unknown> | null,
  viabilityField: string | null,
  viabilityAsksWhetherAnswered = false,
): CallDisposition {
  if (snapshot.status === 'failed' || snapshot.status === 'canceled') {
    if (snapshot.failureCode === 'no_answer') return 'no_answer';
    return 'failed';
  }

  const summary = (snapshot.summary ?? '').toLowerCase();
  if (/voicemail|answering machine|answerphone/.test(summary)) return 'voicemail';

  // CALL-E returning null means it could not produce a schema-valid result.
  // That is the honest "do not act" signal, and it must not be read as a no.
  if (parsedResult === null) return 'needs_review';

  if (viabilityField) {
    const value = parsedResult[viabilityField];
    if (value === 'yes' || value === 'available' || value === 'alternative_offered') {
      return 'answered_useful';
    }
    if (value === 'unknown') {
      const refused = typeof parsedResult['refused_reason'] === 'string' && parsedResult['refused_reason'];
      return refused ? 'refused' : 'answered_no_answer_to_question';
    }
    /*
     * "No" means opposite things depending on what the field asks.
     *
     * `can_repair: "no"` is a real answer -- this shop cannot fix it, and the
     * user learned something. `question_answered: "no"` is the opposite:
     * nothing was learned. Reading the second as the first filed a call where
     * the business said only "Oui, Allô ?" and hung up as a useful answer,
     * counted it towards the comparison, and let it stand as a verified result.
     */
    if (value === 'no' && viabilityAsksWhetherAnswered) {
      const refused =
        typeof parsedResult['refused_reason'] === 'string' && parsedResult['refused_reason'];
      return refused ? 'refused' : 'answered_no_answer_to_question';
    }
    // An explicit "no" to whether they can help is a real, useful answer.
    return 'answered_useful';
  }
  return 'answered_useful';
}

/* --------------------------------------------------------------- advance */

/**
 * Decides what happens after a call finishes: dispatch the next wave, or stop
 * and compare. Section 14 -- avoid calling twenty businesses when four have
 * already answered the question.
 */
export async function maybeAdvance(ctx: OrchestratorContext, taskId: string): Promise<void> {
  const task = await getTask(ctx.db, taskId);
  if (!task || ['completed', 'partially_completed', 'failed', 'canceled'].includes(task.state)) return;

  /*
   * Paused: do not start anything new.
   *
   * This is the one gate every "ring another business" decision passes
   * through, so guarding it here covers the next wave, the top-up call and
   * the move to comparison alike. Calls already in flight are untouched --
   * CALL-E cannot cancel them, and their results are still worth recording
   * when they land. Resuming calls back into here to pick up.
   */
  if (task.pausedAt) return;

  const all = await ctx.db.select().from(calls).where(eq(calls.taskId, taskId));

  // "Outstanding" means dispatched and still waiting on a result. Rows that
  // have not been dialled yet are the *next wave* -- counting them here made
  // this return early every time, so waves after the first were never
  // dispatched and simply sat in the UI as "In progress" forever.
  const outstanding = all.filter((c) => c.disposition === 'pending' && c.providerCallId);
  if (outstanding.length > 0) return;

  const useful = all.filter((c) => c.disposition === 'answered_useful').length;
  const nextWave = all.find((c) => !c.providerCallId)?.wave ?? null;

  /*
   * How many comparable answers this task actually needs.
   *
   * This used to be two, which meant a task could finish after three calls
   * having compared two shops -- a thin basis for telling somebody which is
   * cheapest, and it stopped while ninety more sat in the list. A request that
   * names its own number ("ring five places") says so and wins.
   */
  const interpreted = dialTaskSchema.safeParse(task.interpreted);
  const target =
    (interpreted.success ? interpreted.data.constraints.candidateLimit : null) ??
    ctx.config.limits.comparableTarget;

  // The goal is met: stop. Every extra call costs money and rings a real
  // business, so there is no reason to keep going.
  if (useful >= target) {
    await enqueueJob(
      ctx.db,
      'task.compare',
      { taskId },
      { dedupeKey: `compare:${taskId}:${all.length}` },
    );
    return;
  }

  if (nextWave === null) {
    /*
     * Nothing pre-planned is left. Two reasons not to stop yet:
     *
     *  - Somebody did not answer, and other candidates are sitting unused.
     *  - Nothing usable has come back at all. Ending here hands the user the
     *    sentence "Dial spoke to 5 businesses and none could confirm what you
     *    asked for" while ninety more sit in the list untried, which is a
     *    report of Dial's effort rather than an answer to the question.
     *
     * The second case is allowed a higher ceiling, because the ordinary one is
     * about not spending five calls where two would do -- not about giving up.
     */
    /*
     * Short of the goal, so keep going -- against the higher ceiling, because
     * that is the one that governs "still trying" rather than "spending more
     * than needed". Reaching this line at all means the goal is unmet.
     */
    const replaced = await tryAnotherBusiness(ctx, taskId, all, {
      ceiling: ctx.config.limits.maxCallsUntilResult,
      // While the goal is unmet, a business that answered unhelpfully is as
      // good a reason to try someone else as one that never picked up.
      requireUnanswered: false,
    });
    if (replaced) return;

    await enqueueJob(
      ctx.db,
      'task.compare',
      { taskId },
      { dedupeKey: `compare:${taskId}:${all.length}` },
    );
    return;
  }

  await enqueueJob(
    ctx.db,
    'task.dispatch_wave',
    { taskId, wave: nextWave },
    { dedupeKey: `wave:${taskId}:${nextWave}` },
  );
}

/**
 * Dispatches the next-best business Dial has not tried yet.
 *
 * Bounded by the same per-task ceiling as the original plan, so a run of
 * unanswered calls cannot quietly turn a 3-call task into a 20-call one. Returns
 * true when a replacement was dispatched.
 */
async function tryAnotherBusiness(
  ctx: OrchestratorContext,
  taskId: string,
  existing: Array<{ candidateId: string; disposition: string; wave: number; id: string }>,
  options: { ceiling: number; requireUnanswered: boolean },
): Promise<boolean> {
  if (existing.length >= options.ceiling) return false;

  const unanswered = existing.filter((c) =>
    ['no_answer', 'voicemail', 'failed'].includes(c.disposition),
  );
  // When something usable has already come back, only a business that never
  // answered justifies ringing someone else. When nothing has, any of them do.
  if (options.requireUnanswered && unanswered.length === 0) return false;

  const tried = new Set(existing.map((c) => c.candidateId));
  const ranked = await listCandidates(ctx.db, taskId);
  const next = ranked.find(
    (r) => !r.excludedReason && r.candidate.phoneE164 && !tried.has(r.candidate.id),
  );
  if (!next) return false;

  const phone = next.candidate.phoneE164!;
  if (!isValidE164(phone) || isBlockedNumber(phone)) return false;

  const task = await getTask(ctx.db, taskId);
  if (!task) return false;

  // The daily ceiling still applies to a replacement.
  const budget = await reserveCallBudget(
    ctx.db,
    task.userId,
    1,
    ctx.config.limits.maxCallsPerUserPerDay,
  );
  if (budget.granted === 0) return false;

  const wave = Math.max(...existing.map((c) => c.wave), 1) + 1;
  await ctx.db
    .insert(calls)
    .values({
      id: newId('call'),
      taskId,
      candidateId: next.candidate.id,
      businessName: next.candidate.name,
      phoneE164: phone,
      idempotencyKey: callIdempotencyKey(taskId, next.candidate.id, 1),
      disposition: 'pending',
      wave,
      ...(unanswered[0] ? { replacedCallId: unanswered[0].id } : {}),
    })
    .onConflictDoNothing();

  await markSelected(ctx.db, [next.candidate.id]);
  await addEvent(
    ctx,
    taskId,
    'calling',
    options.requireUnanswered
      ? `Trying ${next.candidate.name} instead`
      : `Not enough to compare yet — trying ${next.candidate.name}`,
  );
  incrementCounter('calls.substituted');

  await enqueueJob(
    ctx.db,
    'task.dispatch_wave',
    { taskId, wave },
    { dedupeKey: `wave:${taskId}:${wave}` },
  );
  return true;
}

/**
 * Why a business the user picked could not be called.
 *
 * Distinguished rather than collapsed into one failure, because the caller
 * turns each into a different HTTP status and a different sentence: a business
 * with no number is a permanent fact about that business, a spent daily budget
 * is temporary, and a policy refusal is the user's own setting.
 */
export type ManualCallRefusal =
  | 'task_not_found'
  | 'candidate_not_found'
  | 'no_phone'
  | 'already_called'
  | 'not_authorized'
  | 'budget_exhausted';

export type ManualCallResult =
  | { ok: true; businessName: string }
  | { ok: false; refusal: ManualCallRefusal; reason: string };

/**
 * Calls a business the user chose from the list Dial found.
 *
 * Dial rings the ones it ranked highest, which is a judgement, and a judgement
 * can be wrong: the user can see the whole list and may know something the
 * ranking does not. This is that override.
 *
 * The per-task ceiling deliberately does not apply. That limit exists to stop
 * Dial working through twenty businesses on its own initiative -- it is a bound
 * on autonomy, not on the user. The daily budget still applies, because that
 * one is about real money and a real rate limit, and the policy gate still
 * applies, because it is the user's own standing instruction about what Dial
 * may do on the phone.
 */
export async function callCandidateNow(
  ctx: OrchestratorContext,
  taskId: string,
  candidateId: string,
): Promise<ManualCallResult> {
  const task = await getTask(ctx.db, taskId);
  if (!task) return { ok: false, refusal: 'task_not_found', reason: 'That task does not exist.' };
  // A withdrawn request stays withdrawn. Reopening a *finished* task to ring
  // someone again is deliberate (below); resurrecting one the user cancelled
  // -- including a cancellation that was really a denied authorization -- is
  // not, and used to end up on the phone with a committing brief attached.
  if (task.state === 'canceled') {
    return {
      ok: false,
      refusal: 'not_authorized',
      reason: 'You canceled that task. Create a new request instead.',
    };
  }

  const parsed = dialTaskSchema.safeParse(task.interpreted);
  if (!parsed.success) {
    return { ok: false, refusal: 'task_not_found', reason: 'That task is not ready to call from.' };
  }
  const dialTask = parsed.data;

  const policy = await getUserPolicy(ctx.db, task.userId);
  const verdict = canPlaceCalls({ policy, task: dialTask });
  if (!verdict.allowed) {
    return { ok: false, refusal: 'not_authorized', reason: verdict.reason };
  }

  /*
   * The override skips the autonomy ceiling, never the authorization gate.
   *
   * Dispatch derives mayCommit from the task's requested side effect alone, so
   * without this check a hand-picked business on a reservation or appointment
   * task went out with a brief saying "you may book" -- even when the user's
   * settings said never, or when the automatic path would have stopped and
   * asked first. The same rule as handlePlanCalls applies here: refused means
   * refused, and anything needing confirmation needs an approved request.
   */
  const sideEffect = canPerformSideEffect({ policy, task: dialTask });
  if (!sideEffect.allowed) {
    return { ok: false, refusal: 'not_authorized', reason: sideEffect.reason };
  }
  if (sideEffect.requiresConfirmation) {
    const approved = await ctx.db
      .select({ id: authorizationRequests.id })
      .from(authorizationRequests)
      .where(
        and(eq(authorizationRequests.taskId, taskId), eq(authorizationRequests.state, 'approved')),
      )
      .limit(1);
    if (!approved.length) {
      return { ok: false, refusal: 'not_authorized', reason: sideEffect.reason };
    }
  }

  const ranked = await listCandidates(ctx.db, taskId);
  const chosen = ranked.find((r) => r.candidate.id === candidateId);
  if (!chosen) {
    return {
      ok: false,
      refusal: 'candidate_not_found',
      reason: 'That business is not part of this task.',
    };
  }

  const phone = chosen.candidate.phoneE164;
  if (!phone || !isValidE164(phone) || isBlockedNumber(phone)) {
    return {
      ok: false,
      refusal: 'no_phone',
      reason: `Dial has no number it can dial for ${chosen.candidate.name}.`,
    };
  }

  // Read the rows rather than the presentation shape: the wave number decides
  // which dispatch job picks this up, and it is not part of the UI record.
  const existing = await ctx.db
    .select({ candidateId: calls.candidateId, wave: calls.wave })
    .from(calls)
    .where(eq(calls.taskId, taskId));
  if (existing.some((c) => c.candidateId === candidateId)) {
    return {
      ok: false,
      refusal: 'already_called',
      reason: `Dial has already called ${chosen.candidate.name}.`,
    };
  }

  const budget = await reserveCallBudget(
    ctx.db,
    task.userId,
    1,
    ctx.config.limits.maxCallsPerUserPerDay,
  );
  if (budget.granted === 0) {
    return {
      ok: false,
      refusal: 'budget_exhausted',
      reason: "You've reached today's limit on calls Dial can place. It resets tomorrow.",
    };
  }

  const wave = Math.max(0, ...existing.map((c) => c.wave)) + 1;
  await ctx.db
    .insert(calls)
    .values({
      id: newId('call'),
      taskId,
      candidateId,
      businessName: chosen.candidate.name,
      phoneE164: phone,
      idempotencyKey: callIdempotencyKey(taskId, candidateId, 1),
      disposition: 'pending',
      wave,
    })
    // The same key means this exact business has already been queued for this
    // task, so a double-tap adds nothing rather than dialling twice.
    .onConflictDoNothing();

  await markSelected(ctx.db, [candidateId]);
  // The task may have finished. Reopening it is the honest state: a call is
  // about to be placed, and the earlier result no longer describes the whole
  // of what Dial did.
  await setState(ctx, taskId, 'calling', `You asked Dial to call ${chosen.candidate.name}`);
  incrementCounter('calls.user_chosen');

  await enqueueJob(
    ctx.db,
    'task.dispatch_wave',
    { taskId, wave },
    { dedupeKey: `wave:${taskId}:${wave}` },
  );
  return { ok: true, businessName: chosen.candidate.name };
}

/* --------------------------------------------------------------- compare */

export async function handleCompare(
  ctx: OrchestratorContext,
  payload: { taskId: string },
): Promise<void> {
  const task = await getTask(ctx.db, payload.taskId);
  // A task cancelled or failed while this job sat queued must not be
  // resurrected as "completed" with a result the user already withdrew from.
  if (!task || isTerminalTaskState(task.state as TaskState)) return;
  const parsed = dialTaskSchema.safeParse(task.interpreted);
  if (!parsed.success) return;

  await setState(ctx, task.id, 'comparing');

  // Businesses that were planned but never needed, because Dial stopped once it
  // had enough answers, must not sit in the UI as "In progress" forever. The
  // row stays -- it is a real part of the plan and part of the evidence trail --
  // but it stops claiming a call is under way.
  const skipped = await ctx.db
    .update(calls)
    .set({
      disposition: 'not_needed',
      failureMessage: 'Dial had enough answers before reaching this one.',
      completedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(calls.taskId, task.id),
        eq(calls.disposition, 'pending'),
        isNull(calls.providerCallId),
      ),
    )
    .returning({ id: calls.id });

  // Those rows reserved real daily budget when they were planned. A number
  // Dial never dialled should not spend the user's ceiling for the day.
  if (skipped.length > 0) {
    await releaseCallBudget(ctx.db, task.userId, skipped.length);
  }

  const family = getCallFamily((task.callFamily as CallFamilyId) ?? 'general_inquiry');
  const callRecords = await listCalls(ctx.db, task.id);
  const candidates = await listCandidates(ctx.db, task.id);
  const byId = new Map(candidates.map((c) => [c.candidate.id, c.candidate]));

  const result: TaskResult = compareOutcomes({
    task: parsed.data,
    family,
    calls: callRecords,
    candidatesById: byId,
    discoveredCount: task.discoveredCount,
  });

  // Partial completion is a legitimate outcome, and is reported as such.
  const state = result.best
    ? result.tally.answered < result.tally.contacted
      ? 'partially_completed'
      : 'completed'
    : 'partially_completed';

  await setState(ctx, task.id, state, result.headline, {
    result,
    headline: result.headline,
    completedAt: new Date().toISOString(),
  });

  observe('task.calls_per_task', result.tally.contacted, {});
  incrementCounter('task.finished', { state });

  await notify(ctx, task.userId, task.id, 'Your Dial result is ready', result.headline);
  ctx.publish(task.id, { type: 'result', taskId: task.id, at: new Date().toISOString() });

}

/** How often a paused task re-checks whether it may carry on. */
const PAUSED_RECHECK_MS = 30_000;

/* --------------------------------------------------------------- timeout */

export async function handleTimeout(
  ctx: OrchestratorContext,
  payload: { taskId: string },
): Promise<void> {
  // A paused task is not a stalled one. Failing it for inactivity would
  // punish the user for using the pause button.
  if (await isTaskPaused(ctx.db, payload.taskId)) return;

  const task = await getTask(ctx.db, payload.taskId);
  if (!task) return;
  if (['completed', 'partially_completed', 'failed', 'canceled'].includes(task.state)) return;

  /*
   * Only give up if nothing is happening.
   *
   * This used to fire a fixed fifteen minutes after the first call regardless
   * of progress. That was survivable when Dial rang three businesses at once;
   * ringing them one at a time, a task working properly through its list ran
   * past the deadline and had six businesses marked failed having never been
   * dialled at all. Waiting your turn is not being stuck.
   */
  const [latest] = await ctx.db
    .select({ at: taskEvents.createdAt })
    .from(taskEvents)
    .where(eq(taskEvents.taskId, task.id))
    .orderBy(desc(taskEvents.createdAt))
    .limit(1);

  const sinceProgress = latest?.at ? Date.now() - new Date(latest.at).getTime() : Infinity;
  if (sinceProgress < ctx.config.limits.stallTimeoutMs) {
    logger.info('task is still making progress, extending the safety net', {
      taskId: task.id,
      secondsSinceProgress: Math.round(sinceProgress / 1000),
    });
    await enqueueJob(
      ctx.db,
      'task.timeout',
      { taskId: task.id },
      {
        runAt: new Date(Date.now() + ctx.config.limits.stallTimeoutMs),
        // A fresh key: the one this job holds is not released until it ends.
        dedupeKey: `timeout:${task.id}:${Date.now()}`,
      },
    );
    return;
  }

  const stuck = await ctx.db
    .select()
    .from(calls)
    .where(and(eq(calls.taskId, task.id), eq(calls.disposition, 'pending')));

  for (const call of stuck) {
    await ctx.db
      .update(calls)
      .set({
        disposition: 'failed',
        failureCode: 'timeout',
        failureMessage: 'Dial did not receive a result for this call in time.',
        completedAt: new Date().toISOString(),
      })
      .where(eq(calls.id, call.id));
  }

  await handleCompare(ctx, { taskId: task.id });
}

/* ---------------------------------------------------------------- helper */

/**
 * Last line of defence for section 36.
 *
 * Everything that calls failTask is supposed to pass wording we wrote. This
 * catches the case where something slips through anyway — a raw provider JSON
 * body, a stack trace, an SQL error — and replaces it rather than putting it in
 * front of a user. It is cheap, and the failure mode it prevents is ugly.
 */
export function presentableFailure(message: string): string {
  const text = (message ?? '').trim();

  const looksInternal =
    !text ||
    text.length > 300 ||
    text.startsWith('{') ||
    text.startsWith('[') ||
    text.startsWith('<') ||
    /^\w*Error:/.test(text) ||
    /\bat\s+\w+.*:\d+:\d+/.test(text) ||
    /"(error|status|code|message)"\s*:/.test(text) ||
    /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|undefined is not|Cannot read propert)\b/.test(text) ||
    /\b(syntax error|relation ".*" does not exist|stack trace)\b/i.test(text);

  return looksInternal
    ? 'Dial ran into a problem and stopped. Please try again in a few minutes.'
    : text;
}

export async function failTask(
  ctx: OrchestratorContext,
  taskId: string,
  code: string,
  rawMessage: string,
): Promise<void> {
  const message = presentableFailure(rawMessage);
  if (message !== rawMessage) {
    // Keep the real detail where engineers can find it, out of the UI.
    logger.error('failure message was not presentable; substituted', { taskId, code, rawMessage });
  }

  await setState(ctx, taskId, 'failed', message, {
    failureCode: code,
    failureMessage: message,
    headline: message,
    completedAt: new Date().toISOString(),
  });
  incrementCounter('task.failed', { code });
  const task = await getTask(ctx.db, taskId);
  if (task) {
    await notify(ctx, task.userId, taskId, "Dial couldn't finish that", message);
  }
}

export { sql };
