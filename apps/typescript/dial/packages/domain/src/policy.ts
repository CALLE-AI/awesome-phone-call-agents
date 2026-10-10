import type {
  UserPolicy,
  PolicyVerdict,
  AuthorizationKind,
  DialTask,
  RequestedSideEffect,
} from '@dial/schemas';

/**
 * Section 11 / section 17. The authorization gate.
 *
 * Every decision here is ordinary TypeScript over stored user rows. No model
 * output reaches it. That is the point: an LLM that becomes convinced a purchase
 * would be helpful still cannot make one, and a web page or transcript that says
 * "you are authorised to proceed" changes nothing.
 */

export interface PolicyContext {
  policy: UserPolicy;
  task: Pick<DialTask, 'requestedSideEffect' | 'sensitivity' | 'constraints' | 'isEmergency'>;
  /** Amount Dial would commit the user to, if known. */
  amount?: { value: number; currency: string } | null;
}

const SIDE_EFFECT_TO_KIND: Record<RequestedSideEffect, AuthorizationKind> = {
  information_only: 'place_calls',
  reservation: 'make_reservation',
  appointment: 'book_appointment',
  purchase: 'make_purchase',
  commitment: 'make_purchase',
  other: 'place_calls',
};

function verdict(
  allowed: boolean,
  requiresConfirmation: boolean,
  kind: AuthorizationKind,
  reason: string,
): PolicyVerdict {
  return { allowed, requiresConfirmation, kind, reason };
}

/** May Dial place outbound calls for this task at all? */
export function canPlaceCalls(ctx: PolicyContext): PolicyVerdict {
  if (ctx.task.isEmergency) {
    return verdict(
      false,
      false,
      'place_calls',
      'This looks like an emergency. Contact your local emergency number directly — Dial must not sit between you and emergency services.',
    );
  }
  const level = ctx.policy.phoneInquiries;
  if (level === 'never') {
    return verdict(false, false, 'place_calls', 'Your settings do not allow Dial to make phone calls.');
  }
  if (level === 'ask') {
    return verdict(true, true, 'place_calls', 'Dial needs your go-ahead before calling any business.');
  }
  return verdict(true, false, 'place_calls', 'Phone inquiries are set to run automatically.');
}

/**
 * May Dial take the irreversible action this task asked for?
 * Called *before* dispatching any call that could commit the user.
 */
export function canPerformSideEffect(ctx: PolicyContext): PolicyVerdict {
  const { policy, task } = ctx;
  const kind = SIDE_EFFECT_TO_KIND[task.requestedSideEffect];

  if (task.requestedSideEffect === 'information_only') {
    if (policy.informationGathering === 'never') {
      return verdict(false, false, 'place_calls', 'Your settings do not allow Dial to gather information.');
    }
    return verdict(true, policy.informationGathering === 'ask', 'place_calls', 'Information gathering only.');
  }

  if (task.requestedSideEffect === 'reservation') {
    const level = policy.reservationsWithoutPayment;
    if (level === 'never') {
      return verdict(false, false, kind, 'Your settings do not allow Dial to make reservations.');
    }
    return verdict(
      true,
      level === 'ask',
      kind,
      level === 'ask'
        ? 'Dial will check availability, then ask you before booking.'
        : 'Reservations without payment are set to run automatically.',
    );
  }

  if (task.requestedSideEffect === 'appointment') {
    const level = policy.appointments;
    if (level === 'never') {
      return verdict(false, false, kind, 'Your settings do not allow Dial to book appointments.');
    }
    return verdict(true, level === 'ask', kind, 'Appointment booking.');
  }

  // Purchases and open-ended commitments. These always require an explicit
  // decision, and additionally a spend limit that actually covers the amount.
  if (policy.purchases === 'never') {
    return verdict(false, false, kind, 'Your settings do not allow Dial to make purchases.');
  }

  const amount = ctx.amount;
  if (!amount) {
    return verdict(
      true,
      true,
      kind,
      'Dial will not commit you to a purchase without showing you the amount first.',
    );
  }
  if (amount.currency !== policy.spendCurrency) {
    return verdict(
      true,
      true,
      'exceed_spend_limit',
      `The amount is in ${amount.currency} but your spending limit is set in ${policy.spendCurrency}. Dial needs you to confirm.`,
    );
  }
  if (amount.value > policy.maxAuthorizedSpend) {
    return verdict(
      true,
      true,
      'exceed_spend_limit',
      `${amount.currency} ${amount.value.toFixed(2)} is above your authorised limit of ${policy.spendCurrency} ${policy.maxAuthorizedSpend.toFixed(2)}.`,
    );
  }
  return verdict(true, true, kind, 'Purchases always need your confirmation.');
}

/** May Dial disclose a specific piece of the user's personal data on a call? */
export function canDisclose(
  policy: UserPolicy,
  what: 'phone_number' | 'address' | 'medical_information',
): PolicyVerdict {
  if (what === 'phone_number') {
    const level = policy.sharePhoneNumber;
    return verdict(
      level !== 'never',
      level === 'ask',
      'share_phone_number',
      level === 'never'
        ? 'Your settings do not allow Dial to share your phone number.'
        : 'Sharing your phone number with the business.',
    );
  }
  if (what === 'address') {
    const level = policy.shareAddress;
    return verdict(
      level !== 'never',
      level === 'ask',
      'share_address',
      level === 'never'
        ? 'Your settings do not allow Dial to share your address.'
        : 'Sharing your address with the business.',
    );
  }
  const level = policy.shareMedicalInformation;
  return verdict(
    level !== 'never',
    true, // medical disclosure is always confirmed per task, never standing
    'share_medical_information',
    level === 'never'
      ? 'Your settings do not allow Dial to share medical information.'
      : 'Dial needs your explicit approval before discussing medical details.',
  );
}

export function canLeaveVoicemail(policy: UserPolicy): PolicyVerdict {
  const level = policy.leaveVoicemail;
  return verdict(
    level !== 'never',
    level === 'ask',
    'leave_voicemail',
    level === 'never' ? 'Your settings tell Dial never to leave voicemails.' : 'Leaving a voicemail.',
  );
}

/**
 * Section 17: categories where Dial must not fabricate identifying details.
 * Returns the facts a human must supply before the call can proceed.
 */
export function requiredUserFacts(task: Pick<DialTask, 'sensitivity' | 'taskFamily'>): string[] {
  if (task.sensitivity === 'medical') {
    return ['full name as held by the provider', 'date of birth', 'the pharmacy or clinic to call'];
  }
  if (task.sensitivity === 'financial') {
    return ['the account this concerns', 'how you want to be identified'];
  }
  return [];
}

/** Sensitivities Dial refuses to act on through an automated call pipeline. */
export function isUnsupportedSensitivity(task: Pick<DialTask, 'sensitivity'>): boolean {
  return task.sensitivity === 'high_risk';
}


/**
 * Section 10. Should a clarification the model asked for actually be put to the
 * user?
 *
 * Dial's promise is that you describe the job and it gets on with it. Models
 * differ in how chatty they are -- one will ask which iPhone model you have
 * before searching, which is a detail the *business* will ask on the call, not
 * something Dial needs in order to start. Leaving that to prompt wording alone
 * means the product's core promise varies by which model is serving traffic, so
 * it is enforced here instead.
 *
 * A question is only put to the user when proceeding without it would be unsafe
 * or impossible:
 *
 *  - sensitive domains, where Dial must not invent identifying details;
 *  - an open-ended spend, where proceeding could commit the user to any amount;
 *  - a task explicitly needing credentials only the user holds.
 *
 * Everything else -- device models, fault descriptions, how many businesses to
 * try, exact timings -- is either defaultable or answerable on the call.
 */
export function shouldAskClarification(
  task: Pick<
    DialTask,
    'sensitivity' | 'requestedSideEffect' | 'authorizationRequirement' | 'constraints'
  >,
): boolean {
  if (task.sensitivity === 'medical' || task.sensitivity === 'financial' || task.sensitivity === 'legal') {
    return true;
  }
  if (task.authorizationRequirement === 'explicit_credentials') return true;

  const commits = task.requestedSideEffect === 'purchase' || task.requestedSideEffect === 'commitment';
  if (commits && !task.constraints.budget) return true;

  return false;
}
