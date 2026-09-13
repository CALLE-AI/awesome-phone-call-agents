# Ringback Final Product Server & Engine (PowerShell HttpListener)
# Implements:
# 1. Natural language intent/target planner (pharmacy, doctor office, insurance)
# 2. Internal CALL-E task generator & task-level result_schema
# 3. Asynchronous CALL-E lifecycle API (POST /api/calls -> call_id, GET /api/calls/:id polling)
# 4. Fail-closed verification (Confirmed vs Needs Attention)
# 5. Grandma-friendly UI with live asynchronous call status steps and before/after outcome display.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8080
$ServerVersion = "1.10.1-ship"
# NOTE: IN/en-IN is the production default per spec, but IN-region dialing never
# rang the sandbox number on this account (NO ANSWER without ringing), while
# US/en-US completed to the same number. Sandbox uses proven US route until
# CALL-E enables a local IN line for the account.
$DefaultRegion = "US"
$DefaultLocale = "en-US"

function Load-DotEnv {
  param($Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim()
    [Environment]::SetEnvironmentVariable($k, $v, "Process")
  }
}

Load-DotEnv (Join-Path $Root ".env")
$ApiKey = [Environment]::GetEnvironmentVariable("CALLE_API_KEY", "Process")
$BaseUrl = [Environment]::GetEnvironmentVariable("CALLE_BASE_URL", "Process")
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = "https://api.heycall-e.com" }

# 1. Intent & Target Planner
function Get-CaregiverPlan {
  param([string]$Situation)
  if ([string]::IsNullOrWhiteSpace($Situation)) {
    return @{ valid = $false; error = "Please describe what you need help with." }
  }
  $text = $Situation.ToLower()
  if (($text -match "prior authoriz|pre-authoriz|preauthoriz") -or ($text -match "pharmacy" -and $text -match "doctor" -and ($text -match "approv|authoriz|prescri|sign|form|clearance"))) {
    return @{
      valid = $true
      intent = "prescription_prior_authorization"
      target_type = "doctor_office"
      target_display = "Prescribing Doctor's Office"
      goal = "Determine what is required to initiate or complete the prior authorization"
    }
  }
  if ($text -match "pharmacy" -or $text -match "refill" -or $text -match "prescription ready") {
    return @{
      valid = $true
      intent = "prescription_refill_status"
      target_type = "pharmacy"
      target_display = "Pharmacy"
      goal = "Check prescription status and pickup readiness"
    }
  }
  if ($text -match "appointment" -or $text -match "schedule" -or $text -match "reschedule" -or $text -match "available times") {
    $apptDate = Resolve-AppointmentDate $text
    $goal = "Ask the office which appointment types or departments have availability, what slots are open, and what is needed to book"
    if ($apptDate) { $goal = "Ask the office which appointment types or departments have availability on calendar date $apptDate, what slots are open that day, and what is needed to book" }
    return @{
      valid = $true
      intent = "appointment_availability"
      target_type = "doctor_office"
      target_display = "Doctor's Office"
      goal = $goal
      appointment_date = $apptDate
    }
  }
  if ($text -match "insurance" -or $text -match "bill" -or $text -match "charge" -or $text -match "claim") {
    return @{
      valid = $true
      intent = "insurance_billing_question"
      target_type = "insurance_company"
      target_display = "Insurance Provider"
      goal = "Identify and explain the disputed charge or claim coverage"
    }
  }
  return @{
    valid = $true
    intent = "general_caregiver_inquiry"
    target_type = "service_provider"
    target_display = "Service Provider"
    goal = "Follow up on the caregiver's request and obtain clear administrative facts"
  }
}

# 1a. Relative-date resolver (CALL-E rejects vague dates like "next Tuesday", so resolve server-side)
function Resolve-AppointmentDate {
  param([string]$LowerText)
  $days = @{ sunday = 0; monday = 1; tuesday = 2; wednesday = 3; thursday = 4; friday = 5; saturday = 6 }
  foreach ($d in $days.Keys) {
    if ($LowerText -match ("next\s+" + $d) -or $LowerText -match ("on\s+" + $d) -or $LowerText -match ($d + "[\s\.\?,]")) {
      $today = (Get-Date).Date
      $delta = ($days[$d] - [int]$today.DayOfWeek + 7) % 7
      if ($delta -eq 0) { $delta = 7 }
      return ($today.AddDays($delta).ToString("dddd, MMMM d, yyyy"))
    }
  }
  if ($LowerText -match "tomorrow") { return ((Get-Date).Date.AddDays(1).ToString("dddd, MMMM d, yyyy")) }
  return ""
}

# 1b. Contact resolution layer (demo directory + sandbox override, never globally hardcoded)
$script:ContactCache = $null
# NOTE (PS 5.1 quirk): @(Get-Content | ConvertFrom-Json) WRAPS instead of
# flattening, producing a 1-element nested array. Always flatten explicitly.
function Read-JsonArray {
  param([string]$Path)
  $out = @()
  if (-not (Test-Path -LiteralPath $Path)) { return $out }
  try {
    $parsed = Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($e in $parsed) { $out += $e }
  } catch { }
  return $out
}
function Get-DemoContacts {
  $list = Read-JsonArray (Join-Path $Root "contacts.json")
  $custom = Read-JsonArray (Join-Path $Root "ringback_custom_contacts.json")
  return @($list) + @($custom)
}
function Save-CustomContact {
  param([string]$Name, [string]$Type, [string]$Phone)
  $cp = Join-Path $Root "ringback_custom_contacts.json"
  $list = Read-JsonArray $cp
  $list = @($list | Where-Object { [string]$_.phone -ne $Phone })
  $list += @{ name = $Name; type = $Type; phone = $Phone; source = "user_added" }
  ($list | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $cp -Encoding utf8
}
function Mask-Phone {
  param([string]$Phone)
  if ($Phone.Length -gt 4) { return ($Phone.Substring(0, 3) + "****" + $Phone.Substring($Phone.Length - 2)) }
  return "****"
}
# Per-user keys: the browser may send its owner's key in X-Calle-Key (kept only
# in memory for that request, never logged or stored). Falls back to server .env.
# Nobody ever receives anyone else's key: keys only travel inward, never outward.
function Resolve-EffectiveApiKey {
  param([string]$HeaderKey, [string]$ServerKey)
  $h = ([string]$HeaderKey).Trim()
  if ($h -match '^iams_[A-Za-z0-9_\-]{10,}$') { return $h }
  return ([string]$ServerKey).Trim()
}
# 1a2. Phone-number auto-detect (Indian mobiles in free text -> callable contacts)
function Find-PhonesInText {
  param([string]$Text)
  $found = @()
  $compact = ([string]$Text) -replace '(?<=\d)[\s\-\.\(\)]+(?=\d)', ''
  $rx = [regex]'(?<!\d)(?:\+?91|0)?([6-9]\d{9})(?!\d)'
  foreach ($m in $rx.Matches($compact)) {
    $num = "+91" + $m.Groups[1].Value
    if ($found -notcontains $num) { $found += $num }
  }
  return $found
}
$RelatedTargets = @{
  prescription_prior_authorization = @("doctor_office", "pharmacy")
  prescription_refill_status       = @("pharmacy")
  appointment_availability         = @("doctor_office")
  insurance_billing_question       = @("insurance_company")
  medical_office_inquiry           = @("doctor_office")
  general_caregiver_inquiry        = @("service_provider")
}
function Get-EffectivePhone {
  param($Contact)
  $demoMode = [Environment]::GetEnvironmentVariable("DEMO_MODE", "Process")
  if ([string]::IsNullOrWhiteSpace($demoMode)) { $demoMode = "1" }
  $sandbox = [Environment]::GetEnvironmentVariable("SANDBOX_TARGET_PHONE", "Process")
  if ($demoMode -eq "1" -and -not [string]::IsNullOrWhiteSpace($sandbox)) {
    return @{ phone = (($sandbox -replace '[\s\-\(\)]', '')); source = "demo_override" }
  }
  return @{ phone = [string]$Contact.phone; source = [string]$Contact.source }
}
function Resolve-RingbackContacts {
  param($Plan, [string]$Situation)
  $types = $RelatedTargets[$Plan.intent]
  if (-not $types) { $types = @($Plan.target_type) }
  $out = @()
  $seenPhones = @()
  # Numbers the caregiver typed directly in the message come first (opaque refs)
  $detIdx = 0
  foreach ($num in (Find-PhonesInText ([string]$Situation))) {
    $out += @{ ref = ("detected:" + $detIdx); name = "Number from your message"; type = $Plan.target_type; phone_masked = (Mask-Phone $num); source = "detected_in_text" }
    $seenPhones += $num
    $detIdx++
  }
  foreach ($t in $types) {
    $c = @(Get-DemoContacts | Where-Object { $_.type -eq $t } | Select-Object -First 1)
    if ($c.Count -gt 0) {
      # Directory contacts are always listed (distinct parties, even when demo
      # mapping routes them to one sandbox phone). Only detected numbers dedupe.
      $eff = Get-EffectivePhone $c[0]
      $out += @{ ref = ("dir:" + [string]$c[0].name); name = [string]$c[0].name; type = $t; phone_masked = (Mask-Phone $eff.phone); source = $eff.source }
    }
  }
  return $out
}
function Resolve-RingbackContact {
  param($Plan, [string]$UserPhone, [string]$ContactName, [string]$ContactRef, [string]$Situation)
  $clean = ([string]$UserPhone) -replace '[\s\-\(\)]', ''
  if (-not [string]::IsNullOrWhiteSpace($clean)) {
    if ($clean -notmatch '^\+\d{7,15}$') {
      return @{ ok = $false; needs_number = $true; error = "That number does not look valid. Use E.164 digits only, e.g. +15550101." }
    }
    try { Save-AddressBookEntry $Plan.target_type "Saved contact" $clean } catch { }
    return @{ ok = $true; needs_number = $false; name = "Provided number"; phone = $clean; source = "user_provided"; target_type = $Plan.target_type }
  }
  if (-not [string]::IsNullOrWhiteSpace($ContactRef) -and $ContactRef -match '^followup:(.+):(\d+)$') {
    $histId = $Matches[1]
    $histIdx = [int]$Matches[2]
    foreach ($h in (Get-HistoryEntries)) {
      if ([string]$h.call_id -eq $histId) {
        $sugs = @($h.suggested_followups)
        if ($histIdx -ge 0 -and $histIdx -lt $sugs.Count -and [string]$sugs[$histIdx].phone -match '^\+\d{7,15}$') {
          return @{ ok = $true; needs_number = $false; name = "Follow-up from call"; phone = [string]$sugs[$histIdx].phone; source = "call_followup"; target_type = $Plan.target_type }
        }
      }
    }
    return @{ ok = $false; needs_number = $true; error = "That suggested number is no longer available." }
  }
  if (-not [string]::IsNullOrWhiteSpace($ContactRef) -and $ContactRef -match '^detected:(\d+)$') {
    $nums = @(Find-PhonesInText ([string]$Situation))
    $idx = [int]$Matches[1]
    if ($idx -ge 0 -and $idx -lt $nums.Count) {
      return @{ ok = $true; needs_number = $false; name = "Number from your message"; phone = $nums[$idx]; source = "detected_in_text"; target_type = $Plan.target_type }
    }
    return @{ ok = $false; needs_number = $true; error = "That detected number is no longer available. Please type the number again." }
  }
  if ([string]::IsNullOrWhiteSpace($clean) -and [string]::IsNullOrWhiteSpace($ContactName) -and [string]::IsNullOrWhiteSpace($ContactRef)) {
    $book = Get-AddressBook
    $entry = $null
    if ($book -is [hashtable] -and $book.ContainsKey($Plan.target_type)) { $entry = $book[$Plan.target_type] }
    elseif ($book.PSObject -and $book.PSObject.Properties[$Plan.target_type]) { $entry = $book.PSObject.Properties[$Plan.target_type].Value }
    if ($entry -and $entry.phone -match '^\+\d{7,15}$') {
      return @{ ok = $true; needs_number = $false; name = ([string]$entry.name + " (saved)"); phone = [string]$entry.phone; source = "address_book"; target_type = $Plan.target_type }
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($ContactName)) {
    $bare = $ContactName
    if ($bare -match '^dir:(.+)$') { $bare = $Matches[1] }
    $named = @(Get-DemoContacts | Where-Object { $_.name -eq $bare } | Select-Object -First 1)
    if ($named.Count -gt 0) {
      $eff = Get-EffectivePhone $named[0]
      return @{ ok = $true; needs_number = $false; name = [string]$named[0].name; phone = $eff.phone; source = $eff.source; target_type = [string]$named[0].type }
    }
    return @{ ok = $false; needs_number = $true; error = "I couldn't find that contact. Pick one from the list or type a phone number." }
  }
  $match = @(Get-DemoContacts | Where-Object { $_.type -eq $Plan.target_type } | Select-Object -First 1)
  if ($match.Count -gt 0) {
    $c = $match[0]
    $demoMode = [Environment]::GetEnvironmentVariable("DEMO_MODE", "Process")
    if ([string]::IsNullOrWhiteSpace($demoMode)) { $demoMode = "1" }
    $sandbox = [Environment]::GetEnvironmentVariable("SANDBOX_TARGET_PHONE", "Process")
    $effPhone = [string]$c.phone
    $src = "demo_contacts"
    if ($demoMode -eq "1" -and -not [string]::IsNullOrWhiteSpace($sandbox)) {
      $effPhone = ($sandbox -replace '[\s\-\(\)]', '')
      $src = "demo_override"
    }
    return @{ ok = $true; needs_number = $false; name = [string]$c.name; phone = $effPhone; source = $src; target_type = $Plan.target_type }
  }
  return @{ ok = $false; needs_number = $true; contact_name = [string]$Plan.target_display }
}

# 2. Internal Task Generator & Task-Level Result Schema
function Build-RingbackTask {
  # PROVEN SHAPE (decisive test call_IoXUW9 completed live): NO "Call <phone>"
  # prefix in the task (recipient comes from the recipients array only), and
  # the schema goes in recipient_result_schema, not task-level result_schema.
  param($Situation, $Plan, [string]$TargetLabel)
  if ([string]::IsNullOrWhiteSpace($TargetLabel)) { $TargetLabel = "the recipient" }
  $msg = "You are calling " + $TargetLabel + " professionally on behalf of an unpaid family caregiver. Begin the call by introducing yourself as an assistant calling for a family caregiver and clearly stating why you are calling. The caregiver's situation and goal is: """ + $Situation + """. Objective: " + $Plan.goal + "."
  if ($Plan.appointment_date) { $msg = $msg + " The requested day refers to the exact calendar date: " + $Plan.appointment_date + ". Use this exact date on the call." }
  $msg = $msg + " Please speak slowly, clearly, and at a measured pace so an elderly listener can follow every word; explain the situation politely, navigate any phone menus, talk to the representative, ask all necessary clarifying questions, and get a definitive status or clear next steps. Never demand a phone number from anyone; if the other party freely offers a phone number, repeat it back digit by digit to confirm it and include it verbatim in your notes. Do not make medical, financial, or legal decisions on behalf of the family. Only report back accurate administrative facts, requirements, reference numbers, and instructions provided during the call."
  return $msg
}

function Get-RingbackTaskSchema {
  return @{
    type = "object"
    required = @("outcome", "result_summary", "next_step", "confidence_indicator")
    properties = @{
      outcome = @{ type = "string"; enum = @("resolved", "needs_more_info", "rejected", "unclear"); description = "Use resolved if request was completed. Use needs_more_info if caregiver action is required. Use rejected if denied. Use unclear if inconclusive." }
      result_summary = @{ type = "string"; description = "Clear plain-language summary of what was discussed and the outcome." }
      next_step = @{ type = "string"; description = "Specific next step for the caregiver, or None if resolved." }
      confidence_indicator = @{ type = "string"; enum = @("high", "medium", "low"); description = "How clear the answers were." }
    }
    additionalProperties = $false
  }
}

# 1c. Learned address book (local equivalent of phone contacts/CRM: remembers
# numbers the caregiver gave before, per target type; git-ignored, never committed)
function Get-AddressBook {
  $ap = Join-Path $Root "ringback_addressbook.json"
  if (-not (Test-Path -LiteralPath $ap)) { return @{} }
  try { return (Get-Content -LiteralPath $ap -Raw -Encoding utf8 | ConvertFrom-Json) } catch { return @{} }
}
function Save-AddressBookEntry {
  param([string]$TargetType, [string]$Name, [string]$Phone)
  $ap = Join-Path $Root "ringback_addressbook.json"
  $book = @{}
  if (Test-Path -LiteralPath $ap) {
    try { $book = Get-Content -LiteralPath $ap -Raw -Encoding utf8 | ConvertFrom-Json } catch { $book = @{} }
  }
  if ($book -isnot [hashtable]) { $h = @{}; $book.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }; $book = $h }
  $book[$TargetType] = @{ name = $Name; phone = $Phone; updated = (Get-Date -Format o) }
  ($book | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $ap -Encoding utf8
}

# 2a2. Transcript mining: numbers the OTHER party volunteers on the call become
# suggested follow-ups (we never instruct the bot to demand numbers - CALL-E
# declines that; we only extract what was freely offered, with context).
function Find-FollowupNumbers {
  param($TranscriptTurns)
  $found = @()
  $joined = ""
  if ($TranscriptTurns) {
    $joined = ((@($TranscriptTurns) | ForEach-Object { [string]$_.text }) -join " ")
  }
  $idx = 0
  $sentences = [regex]::Split($joined, '(?<=[\.\?!])\s+')
  foreach ($num in (Find-PhonesInText $joined)) {
    $ctx = ""
    foreach ($s in $sentences) {
      if ($s -match '\d[\d\s\-]{6,}\d' -and $ctx -eq "") { $ctx = $s.Trim() }
    }
    if ($ctx.Length -gt 180) { $ctx = $ctx.Substring(0, 180) + "..." }
    $found += @{ index = $idx; phone = $num; phone_masked = (Mask-Phone $num); context = $ctx }
    $idx++
  }
  return $found
}

# 2b. Call history (persisted situation report: what was asked, who was called, verdict)
function Save-HistoryEntry {
  param($Entry)
  $hp = Join-Path $Root "ringback_history.json"
  $hist = Read-JsonArray $hp
  $hist = @($hist) + @($Entry)
  if ($hist.Count -gt 50) { $hist = $hist[($hist.Count - 50)..($hist.Count - 1)] }
  ($hist | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $hp -Encoding utf8
}
function Get-HistoryEntries {
  return Read-JsonArray (Join-Path $Root "ringback_history.json")
}

# 3. Fail-Closed Evaluator
function Evaluate-CallResult {
  param($Call)
  $outcome = "needs_attention"
  $reason = "Call completed but outcome uncertain."
  $structured = $null

  if ($null -eq $Call) {
    return @{ outcome = "needs_attention"; reason = "Call record not found."; structured = $null }
  }

  if ($Call.recipients -and $Call.recipients.Count -gt 0) {
    $structured = $Call.recipients[0].structured_result
  }
  if ($null -eq $structured -and $Call.structured_result) {
    $structured = $Call.structured_result
  }

  $conf = $Call.completion_confidence
  $score = 0.0
  $label = "low"
  if ($null -ne $conf) {
    if ($null -ne $conf.score) { $score = [double]$conf.score }
    if ($null -ne $conf.label) { $label = [string]$conf.label }
  }

  $taskCompleted = $false
  if ($null -ne $Call.task_completed) { $taskCompleted = [bool]$Call.task_completed }

  if ($Call.status -ne "completed") {
    $reason = ("Call did not complete successfully (status: {0})." -f $Call.status)
  } elseif ($null -eq $structured) {
    $reason = "CALL-E returned no structured result (evidence inconclusive)."
  } elseif (-not $taskCompleted) {
    $reason = "Task marked incomplete by CALL-E assessment."
  } elseif ($label -eq "low" -or $score -lt 0.6) {
    $reason = ("Result confidence is low (score: {0}). Manual review required." -f $score)
  } elseif ($structured.outcome -eq "resolved" -and ($label -eq "high" -or $label -eq "medium")) {
    $outcome = "confirmed"
    $reason = [string]$structured.result_summary
  } else {
    $summaryText = if ($structured.result_summary) { [string]$structured.result_summary } else { "Action required by caregiver." }
    $reason = ("Needs attention: {0} (Status: {1})" -f $summaryText, [string]$structured.outcome)
  }

  return @{
    outcome = $outcome
    reason = $reason
    structured = $structured
    confidence = $conf
    evidence = $Call.evidence
    status = $Call.status
  }
}

# HTTP Server Listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add(("http://localhost:{0}/" -f $Port))
$listener.Start()
Write-Output ("Ringback Final Server running at http://localhost:{0}/" -f $Port)

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    if ($req.HttpMethod -eq "GET" -and ($req.Url.AbsolutePath -eq "/" -or $req.Url.AbsolutePath -eq "/index.html")) {
      # Stitch React build is the product UI; classic single-file UI kept as fallback.
      $distIndex = Join-Path $Root "stitch-app\dist\index.html"
      if (Test-Path -LiteralPath $distIndex) {
        $html = Get-Content -LiteralPath $distIndex -Raw -Encoding utf8
      } else {
        $html = Get-Content -LiteralPath (Join-Path $Root "ringback_ui.html") -Raw -Encoding utf8
      }
      $buf = [System.Text.Encoding]::UTF8.GetBytes($html)
      $res.ContentType = "text/html; charset=utf-8"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    elseif ($req.HttpMethod -eq "GET" -and $req.Url.AbsolutePath -eq "/classic.html") {
      $html = Get-Content -LiteralPath (Join-Path $Root "ringback_ui.html") -Raw -Encoding utf8
      $buf = [System.Text.Encoding]::UTF8.GetBytes($html)
      $res.ContentType = "text/html; charset=utf-8"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    elseif ($req.HttpMethod -eq "GET" -and $req.Url.AbsolutePath -like "/assets/*") {
      $rel = $req.Url.AbsolutePath.TrimStart("/").Replace("/", "\")
      $fpath = Join-Path (Join-Path $Root "stitch-app\dist") $rel
      if (Test-Path -LiteralPath $fpath -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($fpath)
        if ($fpath -like "*.js") { $res.ContentType = "application/javascript" }
        elseif ($fpath -like "*.css") { $res.ContentType = "text/css" }
        else { $res.ContentType = "application/octet-stream" }
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    }
    elseif ($req.HttpMethod -eq "POST" -and $req.Url.AbsolutePath -eq "/api/plan") {
      $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $payload = $reader.ReadToEnd() | ConvertFrom-Json
      $reader.Close()
      $plan = Get-CaregiverPlan ([string]$payload.situation)
      $json = ($plan | ConvertTo-Json -Depth 10)
      $buf = [System.Text.Encoding]::UTF8.GetBytes($json)
      $res.ContentType = "application/json"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    elseif ($req.HttpMethod -eq "POST" -and $req.Url.AbsolutePath -eq "/api/resolve") {
      $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $payload = $reader.ReadToEnd() | ConvertFrom-Json
      $reader.Close()
      $sitText = [string]$payload.situation
      $plan = Get-CaregiverPlan $sitText
      if (-not $plan.valid) {
        $res.StatusCode = 400
        $buf = [System.Text.Encoding]::UTF8.GetBytes((@{ error = $plan.error } | ConvertTo-Json))
      } else {
        $contacts = @(Resolve-RingbackContacts $plan $sitText)
        $needNumber = ($contacts.Count -eq 0)
        $out = @{ plan = $plan; contacts = $contacts; need_number = $needNumber }
        if ($needNumber) { $out.message = ("I know who needs to be contacted: {0}. I need their phone number before I can call." -f $plan.target_display) }
        $buf = [System.Text.Encoding]::UTF8.GetBytes(($out | ConvertTo-Json -Depth 10))
      }
      $res.ContentType = "application/json"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    elseif ($req.HttpMethod -eq "GET" -and $req.Url.AbsolutePath -eq "/api/history") {
      $hist = @(Get-HistoryEntries)
      [array]::Reverse($hist)
      $json = (@{ entries = $hist } | ConvertTo-Json -Depth 10)
      $buf = [System.Text.Encoding]::UTF8.GetBytes($json)
      $res.ContentType = "application/json"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    elseif ($req.HttpMethod -eq "POST" -and $req.Url.AbsolutePath -eq "/api/preview") {
      # Burn-free: shows EXACTLY what /api/call would send, sends nothing.
      $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $payload = $reader.ReadToEnd() | ConvertFrom-Json
      $reader.Close()
      $situation = [string]$payload.situation
      $plan = Get-CaregiverPlan $situation
      if (-not $plan.valid) {
        $res.StatusCode = 400
        $buf = [System.Text.Encoding]::UTF8.GetBytes((@{ error = $plan.error } | ConvertTo-Json))
      } else {
        $contact = Resolve-RingbackContact $plan ([string]$payload.phone) ([string]$payload.contact_name) ([string]$payload.contact_ref) $situation
        if (-not $contact.ok) {
          $res.StatusCode = 400
          $buf = [System.Text.Encoding]::UTF8.GetBytes((@{ need_number = $true; error = $contact.error } | ConvertTo-Json -Depth 5))
        } else {
          $task = Build-RingbackTask $situation $plan $contact.name
          $schema = Get-RingbackTaskSchema
          $out = @{
            plan = $plan
            contact_name = $contact.name
            recipients = @(@{ phones = @((Mask-Phone $contact.phone)); region = $DefaultRegion; locale = $DefaultLocale })
            task_head = $task.Substring(0, [Math]::Min(200, $task.Length))
            task_has_phone_prefix = ($task -match '^Call \+')
            schema_kind = "recipient_result_schema"
            schema_required = $schema.required
          }
          $buf = [System.Text.Encoding]::UTF8.GetBytes(($out | ConvertTo-Json -Depth 10))
        }
      }
      $res.ContentType = "application/json"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    elseif ($req.HttpMethod -eq "POST" -and $req.Url.AbsolutePath -eq "/api/contacts") {
      $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $payload = $reader.ReadToEnd() | ConvertFrom-Json
      $reader.Close()
      $nm = ([string]$payload.name).Trim()
      $ph = (([string]$payload.phone) -replace '[\s\-\(\)]', '')
      $tp = ([string]$payload.type).Trim()
      if ([string]::IsNullOrWhiteSpace($tp)) { $tp = "service_provider" }
      if ([string]::IsNullOrWhiteSpace($nm) -or $ph -notmatch '^\+\d{7,15}$') {
        $res.StatusCode = 400
        $buf = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Give the office a name and a valid E.164 number."}')
      } else {
        Save-CustomContact $nm $tp $ph
        $buf = [System.Text.Encoding]::UTF8.GetBytes((@{ ok = $true; ref = ("dir:" + $nm) } | ConvertTo-Json))
      }
      $res.ContentType = "application/json"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    elseif ($req.HttpMethod -eq "GET" -and $req.Url.AbsolutePath -eq "/api/health") {
      $json = (@{ version = $ServerVersion; region = $DefaultRegion; locale = $DefaultLocale } | ConvertTo-Json)
      $buf = [System.Text.Encoding]::UTF8.GetBytes($json)
      $res.ContentType = "application/json"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    elseif ($req.HttpMethod -eq "POST" -and $req.Url.AbsolutePath -eq "/api/call") {
      $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $payload = $reader.ReadToEnd() | ConvertFrom-Json
      $reader.Close()
      $situation = [string]$payload.situation
      $userPhone = [string]$payload.phone
      $contactName = [string]$payload.contact_name
      $contactRef = [string]$payload.contact_ref

      if ([string]::IsNullOrWhiteSpace($situation)) {
        $res.StatusCode = 400
        $err = '{"error":"Please describe what you need help with."}'
        $buf = [System.Text.Encoding]::UTF8.GetBytes($err)
        $res.ContentType = "application/json"
        $res.ContentLength64 = $buf.Length
        $res.OutputStream.Write($buf, 0, $buf.Length)
      } else {
        $plan = Get-CaregiverPlan $situation
        if (-not $plan.valid) {
          $res.StatusCode = 400
          $buf = [System.Text.Encoding]::UTF8.GetBytes((@{ error = $plan.error } | ConvertTo-Json))
          $res.ContentType = "application/json"
          $res.ContentLength64 = $buf.Length
          $res.OutputStream.Write($buf, 0, $buf.Length)
        } else {
          $contact = Resolve-RingbackContact $plan $userPhone $contactName $contactRef $situation
          if (-not $contact.ok) {
            $res.StatusCode = 400
            $need = @{ need_number = $true; plan = $plan; contact_name = $contact.contact_name; error = $contact.error }
            if ($contact.error) { $need.error = $contact.error } else { $need.error = ("I know who needs to be contacted: {0}. I need their phone number before I can call." -f $contact.contact_name) }
            $buf = [System.Text.Encoding]::UTF8.GetBytes(($need | ConvertTo-Json -Depth 10))
            $res.ContentType = "application/json"
            $res.ContentLength64 = $buf.Length
            $res.OutputStream.Write($buf, 0, $buf.Length)
          } else {
            $phone = $contact.phone
            $masked = if ($phone.Length -gt 4) { $phone.Substring(0, 3) + "****" + $phone.Substring($phone.Length - 2) } else { "****" }
            ("[{0}] CALL_REQ contact={1} src={2} phone={3} intent={4}" -f (Get-Date -Format o), $contact.name, $contact.source, $masked, $plan.intent) | Out-File -FilePath (Join-Path $Root "ringback_server.log") -Append -Encoding utf8
            if ($contact.source -eq "call_followup") {
              try { Save-CustomContact ("Follow-up (" + (Get-Date -Format "MMM d") + ")") $contact.target_type $contact.phone } catch { }
            }
            $targetLabel = $contact.name
            if ($contact.source -eq "user_provided") { $targetLabel = "the recipient" }
            $task = Build-RingbackTask $situation $plan $targetLabel
            $schema = Get-RingbackTaskSchema
            $body = @{
              task = $task
              recipients = @(@{ phones = @($phone); region = $DefaultRegion; locale = $DefaultLocale })
              recipient_result_schema = $schema
              metadata = @{ workflow_run_id = "ringback-final"; intent = $plan.intent }
            } | ConvertTo-Json -Depth 10

            $useKey = Resolve-EffectiveApiKey $req.Headers["X-Calle-Key"] $ApiKey
            if ([string]::IsNullOrWhiteSpace($useKey)) {
              $res.StatusCode = 400
              $err = '{"error":"Add your CALL-E API key first (free at https://dashboard.heycall-e.com/account/api-keys). It stays in your browser session only."}'
              $buf = [System.Text.Encoding]::UTF8.GetBytes($err)
              $res.ContentType = "application/json"
              $res.ContentLength64 = $buf.Length
              $res.OutputStream.Write($buf, 0, $buf.Length)
            } else {
            $idemKey = "ringback-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
            $resp = Invoke-RestMethod -Uri "$BaseUrl/v1/calls" -Method Post -Body $body -ContentType "application/json" `
              -Headers @{ Authorization = "Bearer $useKey"; "Idempotency-Key" = $idemKey }
            ("[{0}] CREATED id={1} contact={2} src={3}" -f (Get-Date -Format o), $resp.id, $contact.name, $contact.source) | Out-File -FilePath (Join-Path $Root "ringback_server.log") -Append -Encoding utf8

            if (-not $script:PendingCalls) { $script:PendingCalls = @{} }
            $sitShort = [string]$situation
            if ($sitShort.Length -gt 140) { $sitShort = $sitShort.Substring(0, 140) + "..." }
            $script:PendingCalls[$resp.id] = @{ situation = $sitShort; contact = [string]$contact.name; intent = [string]$plan.intent }
            $out = @{
              call_id = $resp.id
              status = $resp.status
              plan = $plan
              contact_name = $contact.name
              contact_phone_masked = $masked
            }
            $json = ($out | ConvertTo-Json -Depth 10)
            $buf = [System.Text.Encoding]::UTF8.GetBytes($json)
            $res.ContentType = "application/json"
            $res.ContentLength64 = $buf.Length
            $res.OutputStream.Write($buf, 0, $buf.Length)
            }
          }
        }
      }
    }
    elseif ($req.HttpMethod -eq "GET" -and $req.Url.AbsolutePath -match "^/api/call/(.+)d*$") {
      $callId = $Matches[1]
      $pollKey = Resolve-EffectiveApiKey $req.Headers["X-Calle-Key"] $ApiKey
      $call = Invoke-RestMethod -Uri "$BaseUrl/v1/calls/$callId" -Method Get `
        -Headers @{ Authorization = "Bearer $pollKey" }
      $eval = Evaluate-CallResult $call
      $turns = @()
      foreach ($rcp in @($call.recipients)) {
        foreach ($att in @($rcp.attempts)) {
          foreach ($t in @($att.transcript_turns)) { $turns += $t }
        }
      }
      $followups = @(Find-FollowupNumbers $turns)
      if ($followups.Count -gt 0) {
        $pub = @()
        foreach ($f in $followups) {
          $pub += @{ ref = ("followup:" + $callId + ":" + $f.index); phone_masked = $f.phone_masked; context = $f.context }
        }
        $eval | Add-Member -NotePropertyName suggested_followups -NotePropertyValue $pub -Force
      }
      if ($call.status -eq "completed" -or $call.status -eq "failed" -or $call.status -eq "canceled") {
        $fc = $call.failure_code
        $fm = $call.failure_message
        ("[{0}] OUTCOME id={1} status={2} failure={3}/{4} task_completed={5}" -f (Get-Date -Format o), $callId, $call.status, $fc, $fm, $call.task_completed) | Out-File -FilePath (Join-Path $Root "ringback_server.log") -Append -Encoding utf8
        $pend = $null
        if ($script:PendingCalls -and $script:PendingCalls.ContainsKey($callId)) { $pend = $script:PendingCalls[$callId] }
        $nextStep = ""
        if ($eval.structured -and $eval.structured.next_step) { $nextStep = [string]$eval.structured.next_step }
        $pubFull = @()
        foreach ($f in (Find-FollowupNumbers $turns)) {
          $pubFull += @{ ref = ("followup:" + $callId + ":" + $f.index); phone = $f.phone; phone_masked = $f.phone_masked; context = $f.context }
        }
        Save-HistoryEntry @{
          time = (Get-Date -Format o); call_id = $callId; status = [string]$call.status
          outcome = [string]$eval.outcome; reason = [string]$eval.reason
          structured = $eval.structured; intent = [string]$call.metadata.intent
          situation = if ($pend) { [string]$pend.situation } else { "" }
          contact = if ($pend) { [string]$pend.contact } else { "" }
          next_step = $nextStep
          suggested_followups = $pubFull
        }
      }
      $payload = @{
        call_id = $callId
        status = $call.status
        evaluation = $eval
      }
      $json = ($payload | ConvertTo-Json -Depth 20)
      $buf = [System.Text.Encoding]::UTF8.GetBytes($json)
      $res.ContentType = "application/json"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    else {
      $res.StatusCode = 404
    }
  } catch {
    $res.StatusCode = 500
    $detail = $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $detail + " | BODY: " + $_.ErrorDetails.Message }
    ("[{0}] ERROR {1} {2} :: {3}" -f (Get-Date -Format o), $req.HttpMethod, $req.Url.AbsolutePath, $detail) | Out-File -FilePath (Join-Path $Root "ringback_server.log") -Append -Encoding utf8
    $safe = $detail.Replace('"', "'")
    $err = ('{{"error":"{0}"}}' -f $safe)
    $buf = [System.Text.Encoding]::UTF8.GetBytes($err)
    $res.ContentType = "application/json"
    $res.ContentLength64 = $buf.Length
    $res.OutputStream.Write($buf, 0, $buf.Length)
  } finally {
    $res.OutputStream.Close()
  }
}
