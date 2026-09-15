import { FIXTURE_KINDS, makeFixture } from './fixtures.ts';
import { verifyClaimOutcome } from './verify.ts';

export function evaluate(perFamily = 80) {
  let safeCases = 0, unsafeCases = 0, safeAccepted = 0, unsafeAccepted = 0;
  for (const kind of FIXTURE_KINDS) {
    for (let index = 0; index < perFamily; index++) {
      const fixture = makeFixture(kind, index);
      const accepted = verifyClaimOutcome(fixture.input).autoAccept;
      if (fixture.expectedAutoAccept) { safeCases++; if (accepted) safeAccepted++; }
      else { unsafeCases++; if (accepted) unsafeAccepted++; }
    }
  }
  return { cases: safeCases + unsafeCases, safeCases, unsafeCases, safeAccepted, unsafeAccepted, unsafeWithheld: unsafeCases - unsafeAccepted };
}
