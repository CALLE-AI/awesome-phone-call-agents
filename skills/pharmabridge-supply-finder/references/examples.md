# Examples

All phone numbers below are fictional (NANP 555-01xx) or masked.

## 1. Blood units near a hospital (simulation)

User: "My father needs 2 units of O negative platelets at General Hospital. Can you check blood banks nearby?"

```bash
node scripts/pharmabridge.mjs discover --kind blood_bank --near "Chennai, India" --radius 8
node scripts/pharmabridge.mjs plan --kind blood_bank --group O- --component platelets --units 2 --hospital "General Hospital" --facility 1
node scripts/pharmabridge.mjs call --kind blood_bank --group O- --component platelets --units 2 --hospital "General Hospital" --facility 1,2,3 --routing simulation
node scripts/pharmabridge.mjs wait
```

Report:

> Lifeline Blood Bank (1.2 km) can issue 2 units today and will reserve them for about 6 hours.
> Staff said: "Yes, we can give you 2 units right now." They need a requisition signed by the
> treating doctor, a patient sample for cross-matching, and one replacement donor.
> City Central Blood Centre has none and suggested the regional blood centre. General Hospital
> Blood Bank did not answer.

## 2. Shortage medication with live calls to test lines

User: "Find lisdexamfetamine 30 mg near Brooklyn. Use my test phones; the operator code is in my notes."

```bash
node scripts/pharmabridge.mjs drug --query "lisdexamfetamine 30 mg capsule"
node scripts/pharmabridge.mjs discover --kind pharmacy --near "Brooklyn, NY" --radius 3
node scripts/pharmabridge.mjs call --kind pharmacy --rxcui 854834 --quantity "30 capsules" --facility 1,2 --routing test_line --operator-code "<ask the user>"
node scripts/pharmabridge.mjs wait
```

Before dispatching, confirm: "This places 2 live calls to your allowlisted test lines (+1 ••• ••• ••99). OK?"

## 3. Nobody confirmed stock

When no call confirms the full quantity, say so plainly and keep every answer visible:

> None of the 5 pharmacies confirmed 30 capsules. Two declined to share controlled-substance
> inventory by phone (that is a refusal, not a "no"). One has 20 mg capsules; switching strength is
> the prescriber's decision. One expects a delivery Thursday. One went to voicemail.
> Next options: widen the search radius, retry the voicemail later, or ask the prescriber about the
> 20 mg alternative.
