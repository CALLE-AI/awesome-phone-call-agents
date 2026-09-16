# Safety Reference

A call script is not just prose - it is an instruction that a voice agent will act on with a real person on the other end of a real phone call. These rules apply to every `task` and `result_schema` this skill helps draft, whether or not the linter can detect a violation.

## Consent And Disclosure

Only draft a call for a recipient the user has a legitimate reason to call, and only when the user has not indicated the recipient should not be called. The task's identification line (see `references/script-patterns.md`) exists so the recipient can tell who is calling and why - never draft a task that omits it or that asks the agent to misrepresent who it is calling on behalf of.

Do not draft a task that asks the agent to claim an authority it does not have - for example, claiming to be a government agency, law enforcement, or a person's bank calling to "verify" their account, when that is not actually the case.

## Never Solicit Sensitive Data

A phone agent must never be instructed to collect: Social Security numbers, credit card or bank account numbers, CVVs, PINs, passwords, or a mother's maiden name. This is true even when the stated purpose sounds legitimate ("verify identity", "confirm payment") - a phone call is not a secure channel for this data, and asking for it trains people to give it out over the phone to whoever calls next. The linter's `TASK_SENSITIVE_DATA` check enforces this; treat any hit as a required rewrite, not a warning to weigh.

Dates of birth are included in this list because, combined with a name, they are commonly used for identity verification elsewhere. If a call genuinely needs a date to schedule something (an appointment date, not a birth date), say so explicitly in the task so it is unambiguous which date is meant.

## Never Imply A Commitment The Caller Cannot Honour

Do not draft a task that has the agent promise a specific outcome, approval, refund, discount, or callback time unless the calling system is actually authorized to commit to it. If the call needs to offer a callback, have the agent capture the recipient's preferred time in the result rather than promising the call will happen at that time.

## Honouring A Request Not To Be Called Again

If the task anticipates the recipient may ask not to be contacted again, instruct the agent to accept that immediately, without arguing or asking why, and to end the call. Do not draft a task that has the agent try to talk the recipient out of a stated refusal or a do-not-call request. Whatever system placed the call is responsible for recording that outcome and not calling that number again - the task text is not a substitute for that, but it must not work against it either.

## Calling Windows And Timezones

Do not schedule or imply a call outside a reasonable local-time window. The US federal TCPA (47 U.S.C. 227, implementing rules at 47 CFR 64.1200) restricts telephone solicitation calls to 8:00am-9:00pm in the **called party's** local time; some states are stricter. This skill drafts call content, not scheduling - but a task that references "calling first thing in the morning" or "calling late tonight" should be checked against this window before the call is scheduled. This is a guard rail, not legal advice: it does not determine which calls count as solicitation or which state's rules apply, and the operator scheduling the call is responsible for that determination.

## Never Infer Region, Locale, Or Timezone From A Phone Number

A phone number's country code is not reliable evidence of where its owner currently is, what language they prefer, or what timezone applies to them - mobile numbers travel with their owners across countries and time zones. Never have a task assume a language, region, or calling-window timezone based on the destination number. If the timezone or locale matters, require it as an explicit, separately supplied value rather than deriving it from the number.
