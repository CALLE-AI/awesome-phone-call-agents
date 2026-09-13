# Ringback Automated Unit & Integration Tests (Tests A-G)
# Verifies intent planner, task generation, schema constraints, and fail-closed evaluation.

$script:passed = 0
$script:failed = 0

function Assert-Equal {
  param($Name, $Actual, $Expected)
  if ($Actual -eq $Expected) {
    Write-Output ("PASS: {0}" -f $Name)
    $script:passed++
  } else {
    Write-Output ("FAIL: {0} - expected <{1}> got <{2}>" -f $Name, $Expected, $Actual)
    $script:failed++
  }
}

# Read functions from ringback_server.ps1 without starting the HTTP listener block (lines 1 to 205)
$serverScript = Get-Content "C:\Users\user\Documents\call-e\ringback_server.ps1" -Raw
$functionsOnly = $serverScript.Substring(0, $serverScript.IndexOf('$listener ='))
Invoke-Expression $functionsOnly

# Deterministic production path: ignore any machine-level sandbox override so
# resolved numbers are the fictional directory values (valid E.164).
$env:DEMO_MODE = "0"

# TEST A: Pharmacy prior authorization
$pA = Get-CaregiverPlan "My wife's pharmacy says her blood pressure medication needs prior authorization from her doctor."
Assert-Equal "Test A intent" $pA.intent "prescription_prior_authorization"
Assert-Equal "Test A target" $pA.target_type "doctor_office"

# TEST B: Appointment availability
$pB = Get-CaregiverPlan "I need to know if my doctor has an appointment next Tuesday."
Assert-Equal "Test B intent" $pB.intent "appointment_availability"
Assert-Equal "Test B target" $pB.target_type "doctor_office"

# TEST C: Insurance billing
$pC = Get-CaregiverPlan "My insurance sent me a bill I don't understand."
Assert-Equal "Test C intent" $pC.intent "insurance_billing_question"
Assert-Equal "Test C target" $pC.target_type "insurance_company"

# TEST D: Missing / empty input validation
$pD = Get-CaregiverPlan ""
Assert-Equal "Test D valid" $pD.valid $false

# TEST F/G: Fail-closed evaluation tests
$resF1 = Evaluate-CallResult @{ status = "failed"; completion_confidence = @{ score = 0.9; label = "high" }; evidence = @() }
Assert-Equal "Test F1 outcome" $resF1.outcome "needs_attention"

$resF2 = Evaluate-CallResult @{ status = "completed"; recipients = @(@{ structured_result = $null }); completion_confidence = @{ score = 0.9; label = "high" }; evidence = @() }
Assert-Equal "Test F2 outcome" $resF2.outcome "needs_attention"

$resG = Evaluate-CallResult @{ status = "completed"; recipients = @(@{ structured_result = @{ outcome = "resolved"; result_summary = "Done" } }); completion_confidence = @{ score = 0.4; label = "low" }; evidence = @() }
Assert-Equal "Test G low confidence" $resG.outcome "needs_attention"

$resOK = Evaluate-CallResult @{ status = "completed"; task_completed = $true; recipients = @(@{ structured_result = @{ outcome = "resolved"; result_summary = "Prior auth initiated." } }); completion_confidence = @{ score = 0.95; label = "high" }; evidence = @("Done") }
Assert-Equal "Test Happy Confirmed" $resOK.outcome "confirmed"

# Resolver: doctor_office plan with no user phone -> demo contact, valid E.164
$planRx = Get-CaregiverPlan "My wife's pharmacy says her blood pressure medicine needs approval from her doctor."
$resRx = Resolve-RingbackContact $planRx ""
Assert-Equal "Test R1 resolved" $resRx.ok $true
Assert-Equal "Test R1 needs_number" $resRx.needs_number $false
Assert-Equal "Test R1 phone E164" ($resRx.phone -match '^\+\d{7,15}$') $true

# Resolver: explicit user phone wins over directory
$resUser = Resolve-RingbackContact $planRx "+15551234567"
Assert-Equal "Test R2 user phone" $resUser.phone "+15551234567"
Assert-Equal "Test R2 source" $resUser.source "user_provided"

# Resolver: invalid user phone -> ask for number, no call
$resBad = Resolve-RingbackContact $planRx "not-a-number"
Assert-Equal "Test R3 bad phone blocks" $resBad.ok $false

# Resolver: unknown target type with no phone -> need_number, no call
$resNone = Resolve-RingbackContact @{ target_type = "alien_office"; target_display = "Alien Office" } ""
Assert-Equal "Test R4 need_number" $resNone.needs_number $true

# Schema guard: no reserved CALL-E field names in task schema
$schema = Get-RingbackTaskSchema
$reserved = @("status", "summary", "transcript", "call_id")
$collision = @($schema.required | Where-Object { $reserved -contains $_ })
Assert-Equal "Test S1 no reserved fields" $collision.Count 0

# Region default (US proven route; IN restore pending local-line enablement)
Assert-Equal "Test N1 region" $DefaultRegion "US"
Assert-Equal "Test N2 locale" $DefaultLocale "en-US"

# Multi-contact: prior-auth situation resolves doctor + pharmacy
$planMulti = Get-CaregiverPlan "My wife's pharmacy says her blood pressure medicine needs approval from her doctor."
$contactsMulti = @(Resolve-RingbackContacts $planMulti)
Assert-Equal "Test M1 two contacts" $contactsMulti.Count 2
Assert-Equal "Test M2 first is doctor" $contactsMulti[0].type "doctor_office"
Assert-Equal "Test M3 numbers masked" ($contactsMulti[0].phone_masked -match '\*\*\*\*') $true

# Contact-name resolution (browser never holds full numbers)
$resNamed = Resolve-RingbackContact $planMulti "" "CityCare Pharmacy"
Assert-Equal "Test M4 named ok" $resNamed.ok $true
Assert-Equal "Test M5 named phone E164" ($resNamed.phone -match '^\+\d{7,15}$') $true
$resNamedBad = Resolve-RingbackContact $planMulti "" "Nobody Clinic"
Assert-Equal "Test M6 unknown name blocks" $resNamedBad.ok $false

# Appointment date resolver: "next Tuesday" -> real calendar Tuesday date
$appt = Get-CaregiverPlan "I need to know if my doctor has an appointment next Tuesday."
Assert-Equal "Test D1 appt date present" ([string]::IsNullOrWhiteSpace($appt.appointment_date)) $false
Assert-Equal "Test D2 appt is Tuesday" ($appt.appointment_date -match "Tuesday") $true
Assert-Equal "Test D3 goal has date" ($appt.goal -match "calendar date") $true
Assert-Equal "Test D4 goal covers type" ($appt.goal -match "which appointment types") $true

# Number auto-detect: bare 10-digit + +91 forms normalize identically
$nums = @(Find-PhonesInText "Please call 98765 43210 or 9123456780 asap")
Assert-Equal "Test P1 two matches" $nums.Count 2
Assert-Equal "Test P2 normalized" $nums[0] "+919876543210"
Assert-Equal "Test P2b spaced digits" $nums[1] "+919123456780"
$numsNone = @(Find-PhonesInText "No numbers here, just call the pharmacy.")
Assert-Equal "Test P3 none" $numsNone.Count 0

# Resolver surfaces detected numbers first with opaque refs
$planNum = Get-CaregiverPlan "My pharmacy needs approval, my number is 9876543210, please call me back."
$contactsNum = @(Resolve-RingbackContacts $planNum "My pharmacy needs approval, my number is 9876543210, please call me back.")
Assert-Equal "Test P4 detected first" $contactsNum[0].ref "detected:0"
Assert-Equal "Test P5 detected source" $contactsNum[0].source "detected_in_text"
Assert-Equal "Test P6 no raw phone leaked" ($contactsNum[0].PSObject.Properties.Name -notcontains "phone") $true
$resRef = Resolve-RingbackContact $planNum "" "" "detected:0" "My pharmacy needs approval, my number is 9876543210, please call me back."
Assert-Equal "Test P7 ref roundtrip" $resRef.phone "+919876543210"

# Proven call shape (decisive live test): no phone prefix, self-introduction present
$planShape = Get-CaregiverPlan "My wife's pharmacy says her blood pressure medicine needs approval from her doctor."
$taskShape = Build-RingbackTask "My wife's pharmacy says her blood pressure medicine needs approval." $planShape "Dr. Sharma's Office"
Assert-Equal "Test T1 no phone prefix" ($taskShape -match '^Call \+') $false
Assert-Equal "Test T2 self intro" ($taskShape -match 'introducing yourself') $true
Assert-Equal "Test T3 names recipient" ($taskShape -match "Sharma") $true

# Address book: learn once, resolve next time with no number given
$abPath = "C:\Users\user\Documents\call-e\ringback_addressbook.json"
$hadAb = Test-Path -LiteralPath $abPath
$abBak = $null
if ($hadAb) { $abBak = Get-Content -LiteralPath $abPath -Raw -Encoding utf8 }
if (Test-Path -LiteralPath $abPath) { Remove-Item -LiteralPath $abPath -Force }
$planAb = Get-CaregiverPlan "I need to know if my doctor has an appointment next Tuesday."
$learn = Resolve-RingbackContact $planAb "+15557654321" "" "" ""
Assert-Equal "Test B1 learn ok" $learn.ok $true
$recall = Resolve-RingbackContact $planAb "" "" "" ""
Assert-Equal "Test B2 recall works" $recall.ok $true
Assert-Equal "Test B3 recall phone" $recall.phone "+15557654321"
Assert-Equal "Test B4 recall source" $recall.source "address_book"
if ($hadAb) { $abBak | Set-Content -LiteralPath $abPath -Encoding utf8 } else { Remove-Item -LiteralPath $abPath -ErrorAction SilentlyContinue }

# Per-user keys: header key wins when valid, else server key; garbage never passes
Assert-Equal "Test K1 header wins" (Resolve-EffectiveApiKey "iams_live_abc123XYZ456" "iams_live_server") "iams_live_abc123XYZ456"
Assert-Equal "Test K2 fallback" (Resolve-EffectiveApiKey "" "iams_live_server") "iams_live_server"
Assert-Equal "Test K3 garbage rejected" (Resolve-EffectiveApiKey "not-a-key" "iams_live_server") "iams_live_server"

# Slow-speech + repeat-back instruction present in every task
$planSlow = Get-CaregiverPlan "My wife's pharmacy says her blood pressure medicine needs approval from her doctor."
$taskSlow = Build-RingbackTask "test situation" $planSlow "Dr. Office"
Assert-Equal "Test V1 slow speech" ($taskSlow -match 'speak slowly') $true
Assert-Equal "Test V2 never demand numbers" ($taskSlow -match 'Never demand a phone number') $true
Assert-Equal "Test V3 repeat back" ($taskSlow -match 'repeat it back digit by digit') $true

# Transcript mining: volunteered number becomes a follow-up with context
$turns = @(
  @{ speaker = "bot"; text = "Hello, calling about the refill." },
  @{ speaker = "user"; text = "Our main line is busy, please call our billing desk on 9123456780 tomorrow." }
)
$mined = @(Find-FollowupNumbers $turns)
Assert-Equal "Test F1 mined count" $mined.Count 1
Assert-Equal "Test F1 mined phone" $mined[0].phone "+919123456780"
Assert-Equal "Test F1 context kept" ($mined[0].context -match "billing") $true
$minedNone = @(Find-FollowupNumbers @(@{ speaker = "user"; text = "Yes, all done, thanks." }))
Assert-Equal "Test F2 none" $minedNone.Count 0

# Follow-up ref roundtrip via history (backup/restore real file)
$hp2 = "C:\Users\user\Documents\call-e\ringback_history.json"
$hadH2 = Test-Path -LiteralPath $hp2
$bak2 = $null
if ($hadH2) { $bak2 = Get-Content -LiteralPath $hp2 -Raw -Encoding utf8 }
Save-HistoryEntry @{ time = "t"; call_id = "call_follow_test"; status = "completed"; outcome = "needs_attention"; reason = "r"; structured = $null; intent = "x"; situation = "s"; contact = "c"; next_step = "n"; suggested_followups = @(@{ ref = "followup:call_follow_test:0"; phone = "+919123456780"; phone_masked = "+91****80"; context = "billing desk" }) }
$resF = Resolve-RingbackContact $planSlow "" "" "followup:call_follow_test:0" ""
Assert-Equal "Test F3 followup resolves" $resF.phone "+919123456780"
Assert-Equal "Test F4 followup source" $resF.source "call_followup"
if ($hadH2) { $bak2 | Set-Content -LiteralPath $hp2 -Encoding utf8 } else { Remove-Item -LiteralPath $hp2 -ErrorAction SilentlyContinue }

# JSON loader returns a flat array (PS 5.1 @(ConvertFrom-Json) nesting guard)
$flatCheck = @(Read-JsonArray "C:\Users\user\Documents\call-e\contacts.json")
Assert-Equal "Test J1 flat count" $flatCheck.Count 3
Assert-Equal "Test J2 flat scalar" ($flatCheck[0].phone -is [string]) $true

# Custom contacts: saved offices resolve henceforth (backup/restore real file)
$ccPath = "C:\Users\user\Documents\call-e\ringback_custom_contacts.json"
$hadCc = Test-Path -LiteralPath $ccPath
$ccBak = $null
if ($hadCc) { $ccBak = Get-Content -LiteralPath $ccPath -Raw -Encoding utf8 }
if (Test-Path -LiteralPath $ccPath) { Remove-Item -LiteralPath $ccPath -Force }
Save-CustomContact "Test Cardiology" "doctor_office" "+15557654321"
$env:DEMO_MODE = "0"
$planCc = Get-CaregiverPlan "Need to check on a cardiology referral."
$resCc = Resolve-RingbackContact $planCc "" "Test Cardiology" "" ""
Remove-Item Env:\DEMO_MODE -ErrorAction SilentlyContinue
Assert-Equal "Test C1 custom resolves" $resCc.ok $true
Assert-Equal "Test C2 custom phone" $resCc.phone "+15557654321"
if ($hadCc) { $ccBak | Set-Content -LiteralPath $ccPath -Encoding utf8 } else { Remove-Item -LiteralPath $ccPath -ErrorAction SilentlyContinue }

# History roundtrip (backup/restore real file)
$hp = "C:\Users\user\Documents\call-e\ringback_history.json"
$hadHist = Test-Path -LiteralPath $hp
$bak = $null
if ($hadHist) { $bak = Get-Content -LiteralPath $hp -Raw -Encoding utf8 }
Save-HistoryEntry @{ time = "test"; call_id = "call_test_only"; status = "completed"; outcome = "confirmed"; reason = "test" }
$hist = @(Get-HistoryEntries)
Assert-Equal "Test H1 history stored" ($hist.call_id -contains "call_test_only") $true
if ($hadHist) { $bak | Set-Content -LiteralPath $hp -Encoding utf8 } else { Remove-Item -LiteralPath $hp -ErrorAction SilentlyContinue }

Write-Output ("\nRINGBACK TEST SUMMARY: passed={0} failed={1}" -f $script:passed, $script:failed)
if ($script:failed -gt 0) { exit 1 }
