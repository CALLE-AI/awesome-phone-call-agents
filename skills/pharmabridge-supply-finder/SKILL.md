---
name: pharmabridge-supply-finder
description: Find a shortage medication or specific blood units by phone. Discovers nearby pharmacies or blood banks, previews the exact CALL-E call brief, checks the Shortage Pulse for fresh answers from earlier calls, places CALL-E phone calls through a running PharmaBridge server, and reports ranked, evidence-backed availability.
---

# PharmaBridge supply finder

Use this skill when someone needs a scarce medication or specific blood units and the only way to
find them is to phone pharmacies or blood banks one by one. It drives a running PharmaBridge
server, so every call goes through the same briefs, strict result schemas, and safety gate as the
PharmaBridge app.

## Requirements

- A running PharmaBridge server (`npm run dev` in `apps/typescript/pharmabridge`, default
  `http://localhost:3000`). Set `PHARMABRIDGE_URL` if it runs elsewhere.
- Node.js 20 or newer. The helper has no dependencies.
- The helper sends operator codes and call tokens only to a loopback server (`http://localhost:3000`
  by default) or to an https origin listed in `PHARMABRIDGE_APPROVED_ORIGINS`, never follows
  redirects, and masks phone numbers in everything it prints or saves.
- Simulation needs nothing else. Live calls need the server's live gate (CALL-E key,
  `PHARMABRIDGE_LIVE_CALLS=true`, an operator code, and a signing secret) plus the user's explicit
  approval for each dispatch.

## Workflow

Run the helper from this skill folder: `node scripts/pharmabridge.mjs <command> [options]`.

1. **Clarify the need.** For medicine: drug, strength, form, and quantity. For blood: group,
   component, units, and the hospital where the patient is admitted. Also ask where to search.
2. **Resolve the medication** (pharmacy searches only):
   `node scripts/pharmabridge.mjs drug --query "lisdexamfetamine 30 mg capsule"` and pick the RxCUI.
3. **Discover facilities.** This never dials:
   `node scripts/pharmabridge.mjs discover --kind blood_bank --near "Chennai, India" --radius 8`
   The list is saved to `pharmabridge-facilities.json` with masked numbers and discovery signatures.
4. **Check the Shortage Pulse.** Fresh answers from earlier PharmaBridge calls, shared without names:
   `node scripts/pharmabridge.mjs pulse --kind blood_bank --group O- --component platelets`
   Skip facilities that recently said they are out or won't say by phone, and tell the user when a
   recent answer already covers the need. Controlled medications are never named as in stock.
5. **Preview the brief.** This is a dry run that never dials:
   `node scripts/pharmabridge.mjs plan --kind blood_bank --group O- --component platelets --units 2 --hospital "General Hospital" --facility 1`
   Show the user what the agent will say and which fields it will return.
6. **Confirm with the user** before any call: the facilities, the routing, and how many calls
   will be used. Default to `--routing simulation`.
7. **Dispatch.** Pass the same need options again:
   `node scripts/pharmabridge.mjs call --kind blood_bank --group O- --component platelets --units 2 --hospital "General Hospital" --facility 1,2,3 --routing simulation`
   For live calls, add `--routing test_line` or `--routing direct`, plus `--operator-code <code from the user>`.
   Direct routing also needs `--consent`, and only after the user explicitly approves calling those businesses.
8. **Collect results:** `node scripts/pharmabridge.mjs wait`. This polls until every call ends and
   saves `pharmabridge-results.json`.
9. **Report honestly.** Lead with confirmed availability and quote the staff member's words. Keep
   refusals, voicemail, and unanswered calls in the report, and never turn "we can't say by phone"
   into "no". Offer the next step: hold or reserve through the PharmaBridge app, or share the result.

## Safety rules

Follow `references/safety.md` on every run. In short: simulation first, live calls only with the
user's explicit go-ahead and operator code, no medical advice or substitutions, no patient identity
on inquiry calls, and masked phone numbers in every summary.

## Examples

See `references/examples.md` for a blood request, a shortage-medication request, and how to report
a run where nobody confirmed stock.
