import type { CallPlacer, PlaceCallRequest } from "./calle.js";
import { decideStudent, reduceOutcome, shouldContinueCascade } from "./decide.js";
import { Ledger, idempotencyKey } from "./ledger.js";
import { mayCallGuardian } from "./policy.js";
import { maskPhone } from "./privacy.js";
import { buildReport } from "./report.js";
import { RESULT_SCHEMA, buildTask } from "./script.js";
import type { GuardianAttempt, RollCallInput, RollCallReport, StudentDisposition } from "./types.js";

export interface RunOptions {
  placer: CallPlacer;
  ledger: Ledger;
  now: () => Date;
  /** Called before each call is placed; return false to refuse it. */
  approve?: (request: PlaceCallRequest) => Promise<boolean> | boolean;
  log?: (line: string) => void;
}

/**
 * One school, one morning. For every absence, dial guardians in the listed
 * order until one confirms being the guardian, then decide. Every guardian is
 * either dialled once or listed with the reason they were not.
 */
export async function runRollCall(input: RollCallInput, options: RunOptions): Promise<RollCallReport> {
  const { school } = input;
  const log = options.log ?? (() => {});
  const students: StudentDisposition[] = [];

  for (const absence of input.absences) {
    const attempts: GuardianAttempt[] = [];
    for (let i = 0; i < absence.guardians.length; i++) {
      const guardian = absence.guardians[i];
      const attempt: GuardianAttempt = {
        guardianIndex: i,
        maskedPhone: maskPhone(guardian.phone),
        skippedReason: null,
        outcome: null,
        reduced: null,
      };
      attempts.push(attempt);

      const verdict = mayCallGuardian(guardian, i, absence, school, options.now());
      if (!verdict.allowed) {
        attempt.skippedReason = verdict.reason;
        log(`${absence.firstName}: guardian ${i + 1} not dialled — ${verdict.reason}`);
        continue;
      }

      const key = idempotencyKey(absence.date, absence.studentId, i);
      const prior = options.ledger.get(key);
      if (prior && prior.mode === "live") {
        attempt.skippedReason = `already dialled today (call ${prior.callId} at ${prior.createdAt}, reached ${prior.answeredBy ?? "unknown"})`;
        log(`${absence.firstName}: guardian ${i + 1} not dialled — ${attempt.skippedReason}`);
        // A guardian who was reached earlier today ends the cascade; the
        // earlier report already carries the verdict for this child.
        if (prior.answeredBy === "guardian") break;
        continue;
      }

      const request: PlaceCallRequest = {
        task: buildTask(absence, guardian, school),
        phone: guardian.phone,
        locale: guardian.locale,
        region: guardian.region,
        resultSchema: RESULT_SCHEMA as unknown as Record<string, unknown>,
        idempotencyKey: key,
        metadata: { app: "roll-call", student_id: absence.studentId, guardian_index: String(i) },
      };

      if (options.approve && !(await options.approve(request))) {
        attempt.skippedReason = "refused at approval prompt";
        log(`${absence.firstName}: guardian ${i + 1} refused at approval prompt`);
        continue;
      }

      log(`${absence.firstName}: dialling guardian ${i + 1} ${attempt.maskedPhone} (${options.placer.mode})`);
      const outcome = await options.placer.place(request);
      attempt.outcome = outcome;
      attempt.reduced = reduceOutcome(outcome);
      options.ledger.record({
        idempotencyKey: key,
        studentId: absence.studentId,
        guardianIndex: i,
        callId: outcome.callId,
        createdAt: options.now().toISOString(),
        mode: options.placer.mode,
        answeredBy: options.placer.mode === "live" ? attempt.reduced.answeredBy : null,
      });
      log(
        `${absence.firstName}: guardian ${i + 1} → ${outcome.status}, answered_by=${attempt.reduced.answeredBy}, aware=${attempt.reduced.guardianAware}`,
      );
      if (!shouldContinueCascade(attempt.reduced)) break;
    }

    const decision = decideStudent(attempts, school);
    students.push({
      studentId: absence.studentId,
      firstName: absence.firstName,
      classLabel: absence.classLabel,
      date: absence.date,
      disposition: decision.disposition,
      because: decision.because,
      nextAction: decision.nextAction,
      attempts,
    });
  }

  const date = input.absences[0]?.date ?? options.now().toISOString().slice(0, 10);
  return buildReport(school.schoolName, date, options.placer.mode, students, options.now());
}
