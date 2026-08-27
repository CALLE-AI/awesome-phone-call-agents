#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REQUIRED_ROUTE = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NON_ENGLISH_SCRIPT_RE =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const UNSUPPORTED_BINDING_LEVEL_RE = new RegExp("\\b" + "un" + "bound-" + "generic\\b", "iu");
const UNSUPPORTED_EXECUTION_MODE_RE = new RegExp("\\bper-" + "call-approval\\b", "iu");
const AFFIRMATIVE_PASS_RESULT_RE =
  /^(?:passed|verified|confirmed|completed|succeeded)\b/iu;
const NEGATED_PASS_RESULT_RE =
  /^not[\s_-]+(?:passed|verified|confirmed|completed|succeeded)\b/iu;
const BLOCKING_STATUS_TOKEN_RE =
  /^(?:failed|missing|incomplete|unavailable|not available|unsupported|not run|not ready|not configured|pending|blocked)\b/iu;
const BLOCKING_STATUS_VERB_PHRASE_RE =
  /\b(?:is|are|was|were|be|been|being|remains?|still)\s+(?:failed|missing|incomplete|unavailable|not available|unsupported|not run|not ready|not configured|pending|blocked)\b/iu;
const BLOCKING_STATUS_OBJECT_PHRASE_RE =
  /\b(?:auth(?:entication)?|authorization|oauth|login|setup|configuration|credentials?|route|tools?|run\s+tools?|capability|sample|access|runtime|provider|source|fields?|mapping|connector|onboarding|writeback|permissions?|resources?)\s+(?:failed|missing|incomplete|unavailable|not available|unsupported|not run|not ready|not configured|pending|blocked)\b/iu;
const STATUS_REASON_PREFIX_RE =
  /^(?:because|due to|until|before|while|without|after|by)\b/iu;
const STATUS_EVIDENCE_OBJECT_RE =
  /\b(?:auth(?:entication)?|authorization|oauth|login|setup|configuration|credentials?|route|tools?|capability|sample|access|runtime|provider|source|fields?|mapping|connector|onboarding|writeback|permissions?|resources?)\b/iu;
const REQUIRED_ACTION_STATUS_RESULT_RE =
  /\b(?:auth(?:entication)?|authorization|oauth|login|setup|configuration|action)\s+(?:is\s+)?required\b|\brequired\s+(?:before|to)\b|\b(?:requires|needs?)\b(?=[^.;]*\b(?:auth(?:entication)?|authorization|oauth|login|setup|configuration|action|connector|route|credentials?|onboarding|approval|access)\b)/iu;
const NO_REQUIRED_ACTION_STATUS_RESULT_RE =
  /\bno\s+(?:(?:extra|additional|separate|source|provider|route|mcp|connector|host|local|managed)\s+)*(?:auth(?:entication)?|authorization|oauth|login|setup|configuration|action)\s+(?:is\s+)?required\b|\b(?:(?:source|provider|route|mcp|connector|host|local|managed)\s+)*(?:auth(?:entication)?|authorization|oauth|login|setup|configuration|action)\s+(?:is\s+)?not\s+required\b|\bno\s+need\s+(?:for|to)\b/giu;
const EMPTY_EVIDENCE_RESULT_RE = /^(?:none|n\/a|na|not applicable|no)[.;]*$/iu;
const NO_EXTRA_EVIDENCE_REQUIRED_RE =
  /^no\s+(?:extra|additional|separate)\b.*\b(?:needed|required)\b/iu;
const NO_EVIDENCE_RESULT_RE =
  /^no\b(?=.*\b(?:route|mapping|tools?|capability|runtime|provider|source|goal)\b)|^no\b(?=.*\bsample\b(?!\s+summar))/iu;
const NO_CHANGE_CONFIRMATION_RE =
  /^no\s+(?:changes?|edits?|updates?)\s+(?:needed|required)\b/iu;
const INLINE_NEGATIVE_READY_EVIDENCE_RE =
  /\b(?:with|because|as|using|via|from)\s+no\b(?=[^.;]*\b(?:run\s+tools?|tools?|capability|route|runtime|provider|source|sample|access|mapping|writeback|oauth|auth(?:entication)?)\b)[^.;]*(?:\b(?:exposed|available|configured|present|found|provided|ready)\b)?|\bno\s+(?:(?:compatible|required|provider|mcp|host|source|separate)\s+)*(?:run\s+tools?|run\s+tool|tools?|capability|route|runtime|provider|source|sample|access|mapping|writeback|oauth|auth(?:entication)?)\b[^.;\n]*\b(?:exposed|available|configured|present|found|provided|ready)\b/iu;
const BINDING_LEVEL_RE =
  /^\s*(?:[-*]\s*)?(?:selected\s+)?binding level\s*(?:is|:)\s*`?(fully-bound|parameterized-bound)`?/imu;
const EXECUTION_MODE_RE =
  /^\s*(?:[-*]\s*)?(?:selected\s+)?execution mode\s*(?:is|:)\s*`?(dry-run-then-batch-approval|approved-direct-execution)`?/imu;
const NOTION_SOURCE_FAMILY_RE =
  /^\s*(?:[-*]\s*)?source[_\s-]+family\s*(?::|\bis\b)\s*[`"']?notion[`"']?[.;]?/imu;
const AIRTABLE_SOURCE_FAMILY_RE =
  /^\s*(?:[-*]\s*)?source[_\s-]+family\s*(?::|\bis\b)\s*[`"']?airtable[`"']?[.;]?/imu;
const NOTION_ACCESS_ROUTE_RE =
  /\bnotion\b|\b(?:loadPageChunk|collection_view_page|saveTransactions)\b/iu;
const AIRTABLE_ACCESS_ROUTE_RE = /\bairtable\b/iu;
const PUBLIC_NOTION_READ_ROUTE_RE =
  /\b(?:anonymous|shared[-\s]?(?:notion\s+)?page|public\s+(?:notion\s+)?page(?:\s+metadata)?|loadPageChunk|collection_view_page|saveTransactions)\b/iu;
const PUBLIC_NOTION_WRITEBACK_ROUTE_RE =
  /\b(?:writeback|write[-\s]?back|canary|page\s+property\s+update|property\s+update|update\s+access)\b[^.;\n]*\b(?:through|via|using|from)\s+(?:saveTransactions|loadPageChunk|collection_view_page|public|anonymous|shared[-\s]?(?:notion\s+)?page)\b|\bsaveTransactions\b(?=[^.;\n]*\b(?:writeback|write[-\s]?back|canary|page\s+property\s+update|property\s+update|update\s+access)\b)/iu;
const AUTHENTICATED_NOTION_WRITEBACK_RE =
  /\b(?:canary\s+writeback(?:\/readback)?|writeback\s+readback|write[-\s]?back\s+readback|page\s+(?:property\s+)?(?:writeback|update|readback|update\s+capability)|property\s+(?:writeback|update|readback))\b(?=[^.;\n]*\b(?:verified|passed|passes|confirmed|succeeded|completed)\b)|\b(?:verified|passed|passes|confirmed|succeeded|completed)\b(?=[^.;\n]*\b(?:canary\s+writeback(?:\/readback)?|writeback\s+readback|write[-\s]?back\s+readback|page\s+(?:property\s+)?(?:writeback|update|readback|update\s+capability)|property\s+(?:writeback|update|readback))\b)/iu;
const AUTHENTICATED_NOTION_WRITEBACK_ROUTE_RE =
  /\b(?:hosted\s+notion\s+mcp|notion\s+mcp\s+oauth|oauth\s+(?:notion\s+)?(?:mcp\s+)?(?:route|access|writeback)|authenticated\s+notion\s+(?:route|mcp|writeback|access)|notion\s+api\s+(?:oauth|route|access|writeback)|(?:notion\s+)?(?:managed|approved)\s+connector\s+(?:route|access|writeback|action)|managed\s+notion\s+connector(?:\s+(?:route|access|writeback|action))?|notion\s+connector\s+(?:route|access|writeback|action)|(?:notion\s+)?integration\s+token)\b/iu;
const AUTHENTICATED_NOTION_ROUTE_EVIDENCE_CONTEXT_RE =
  /^\s*(?:[-*]\s*)?(?:access(?:[\s_-]+(?:route|method))?|route[\s_-]+type|source[\s_-]+access[\s_-]+route[\s_-]+discovery[\s_-]+result|authentication(?:[\s_-]+or[\s_-]+access)?[\s_-]+check(?:[\s_-]+result)?|auth(?:entication)?(?:[\s_-]+readiness)?|auth_or_access_check|connector[\s_-]+access|writeback[\s_-]+route|target)\s*:/iu;
const NOTION_AUTH_ROUTE_CREDENTIAL_WARNING_RE =
  /\b(?:do\s+not|must\s+not|should\s+not|never)\s+(?:expose|record|store|log|print|show|share|include|leak|emit)\b[^.;\n]*\b(?:notion\s+integration\s+token|credentials?|token)\b|\b(?:omit|redact|mask|exclude)\b[^.;\n]*\b(?:notion\s+integration\s+token|credentials?|token)\b|\b(?:notion\s+integration\s+token|credentials?|token)\b[^.;\n]*\b(?:must\s+not|should\s+not|never|do\s+not)\s+(?:be\s+)?(?:exposed|recorded|stored|logged|printed|shown|shared|included|leaked|emitted)\b/iu;
const NEGATED_PUBLIC_NOTION_READ_ROUTE_RE =
  /\b(?:no|not|never|without)\s+(?:(?:using|used|selected|choosing|configured|the|a|an|any)\s+)*(?:public|anonymous|shared[-\s]?page|loadPageChunk|collection_view_page|saveTransactions)\b[^.;\n]*[.;]?|\b(?:public|anonymous|shared[-\s]?page|loadPageChunk|collection_view_page|saveTransactions)\b[^.;\n]*(?:(?:not|never)\s+(?:used|selected|chosen|configured|available)|(?:was|were|is|are)\s+not\s+(?:used|selected|chosen|configured|available)|disabled|avoided|rejected)\b[^.;\n]*[.;]?/giu;
const NEGATED_AUTHENTICATED_NOTION_WRITEBACK_RE =
  /\b(?:no|not|never|without)\s+(?:(?:verified|available|configured|enabled|the|a|an|any|separate)\s+)*(?:writeback|write[-\s]?back|canary|page\s+property\s+update|property\s+update|update\s+access)\b[^.;\n]*[.;]?|\b(?:writeback|write[-\s]?back|canary|page\s+property\s+update|property\s+update|update\s+access)\b[^.;\n]*(?:(?:is|was|are|were|remains?)\s+)?(?:not\s+(?:available|verified|configured|enabled|ready|supported)|unavailable|unsupported|blocked|disabled|denied|absent|missing)\b[^.;\n]*[.;]?/giu;
const NEGATED_AUTHENTICATED_NOTION_ROUTE_RE =
  /\b(?:no|not|never|without)\s+(?:(?:using|used|through|via|with|by|from|selected|choosing|configured|available|the|a|an|any|separate|integration)\s+)*(?:hosted\s+notion\s+mcp|notion\s+mcp\s+oauth|oauth\s+(?:notion\s+)?(?:mcp\s+)?(?:route|access|writeback)|authenticated\s+notion\s+(?:route|mcp|writeback|access)|notion\s+integration\s+token|credentials?|auth(?:entication)?|token)\b[^.;\n]*[.;]?|\b(?:hosted\s+notion\s+mcp|notion\s+mcp\s+oauth|oauth\s+(?:notion\s+)?(?:mcp\s+)?(?:route|access|writeback)|authenticated\s+notion\s+(?:route|mcp|writeback|access)|notion\s+integration\s+token)\b[^.;\n]*(?:(?:not|never)\s+(?:used|selected|chosen|configured|available|verified)|(?:was|were|is|are)\s+not\s+(?:used|selected|chosen|configured|available|verified)|without\s+(?:integration\s+)?(?:credentials?|auth(?:entication)?|oauth|token)|disabled|avoided|rejected)\b[^.;\n]*[.;]?/giu;
const READ_ONLY_AIRTABLE_ROUTE_RE =
  /\b(?:read[-\s]?only|sample\s+export|csv\s+export|view[-\s]?only|read\s+access|no\s+(?:write|update|record\s+update)|without\s+(?:write|update|record\s+update))\b/iu;
const AIRTABLE_WRITE_CAPABILITY_RE =
  /\b(?:record\s+update|update\s+access|write\s+access|writeback|patch|non[-\s]?destructive\s+record\s+update|canary\s+writeback)\b/iu;
const VERIFIED_AIRTABLE_WRITE_CAPABILITY_RE =
  /\b(?:canary\s+writeback(?:\/readback)?|writeback\s+readback|write[-\s]?back\s+readback|non[-\s]?destructive\s+record\s+update|record\s+update\s+(?:access|capability|route|readback)|update\s+access|write\s+access|patch(?:\s+(?:writeback|update|request|route|capability))?)\b(?=[^.;\n]*\b(?:verified|passed|passes|succeeded|completed)\b)|\b(?:verified|passed|passes|succeeded|completed|passed\s+with)\b(?=[^.;\n]*\b(?:canary\s+writeback(?:\/readback)?|writeback\s+readback|write[-\s]?back\s+readback|non[-\s]?destructive\s+record\s+update|record\s+update\s+(?:access|capability|route|readback)|update\s+access|write\s+access|patch(?:\s+(?:writeback|update|request|route|capability))?)\b)/iu;
const UNVERIFIED_AIRTABLE_WRITE_CAPABILITY_RE =
  /\b(?:canary\s+writeback|non[-\s]?destructive\s+record\s+update|record\s+update\s+(?:access|capability|route)|update\s+access|write\s+access|writeback)\b[^.;\n]*\b(?:configured|requested|planned|pending)\b|\b(?:configured|requested|planned|pending)\b[^.;\n]*\b(?:canary\s+writeback|non[-\s]?destructive\s+record\s+update|record\s+update\s+(?:access|capability|route)|update\s+access|write\s+access|writeback)\b/iu;
const EXPLICIT_AIRTABLE_WRITE_VERIFICATION_RE =
  /\b(?:canary\s+writeback|non[-\s]?destructive\s+record\s+update|record\s+update\s+(?:access|capability|route)|update\s+access|write\s+access|writeback|writeback\s+readback|record\s+update\s+readback)\b[^.;\n]*\b(?:verified|passed|succeeded|completed|readback)\b|\b(?:verified|succeeded|completed)\b[^.;\n]*\b(?:canary\s+writeback|non[-\s]?destructive\s+record\s+update|record\s+update\s+(?:access|capability|route)|update\s+access|write\s+access|writeback|writeback\s+readback|record\s+update\s+readback)\b/iu;
const NEGATED_AIRTABLE_WRITE_CAPABILITY_RE =
  /\b(?:no|not|never|without)\s+(?:(?:verified|available|configured|enabled|the|a|an|any|separate)\s+)*(?:writeback|write\s+access|update\s+access|record\s+update(?:\s+capability)?|non[-\s]?destructive\s+record\s+update|canary\s+writeback)\b[^.;\n]*[.;]?|\b(?:writeback|write\s+access|update\s+access|record\s+update(?:\s+capability)?|non[-\s]?destructive\s+record\s+update|canary\s+writeback)\b[^.;\n]*(?:(?:is|was|are|were|remains?)\s+)?(?:not\s+(?:available|verified|configured|enabled|ready|supported)|unavailable|unsupported|blocked|disabled|denied|absent|missing)\b[^.;\n]*[.;]?/giu;
const NEGATED_READ_ONLY_AIRTABLE_ROUTE_RE =
  /\b(?:no|not|never|without)\s+(?:(?:using|used|selected|choosing|configured|the|a|an|any)\s+)*(?:read[-\s]?only|sample\s+export|csv\s+export|view[-\s]?only)\b[^.;\n]*[.;]?|\b(?:read[-\s]?only|sample\s+export|csv\s+export|view[-\s]?only)\b[^.;\n]*(?:(?:not|never)\s+(?:used|selected|chosen|configured|available)|(?:was|were|is|are)\s+not\s+(?:used|selected|chosen|configured|available)|disabled|avoided|rejected)\b[^.;\n]*[.;]?/giu;
const SOURCE_WRITEBACK_RESULT_MODE_RE =
  /^\s*(?:[-*]\s*)?(?:(?:runtime\s+)?(?:result output policy|result[-\s]?output policy|result target mode|output target mode|target mode)|policy|target_mode)\s*:\s*[`"']?(?:(?:resolved|fixed|runtime|parameterized)\s+)?[`"']?source-writeback\b(?!\s*(?:[`"']\s*)?\|)/imu;
const NON_WRITEBACK_RESULT_MODE_RE =
  /^\s*(?:[-*]\s*)?(?:(?:runtime\s+)?(?:result output policy|result[-\s]?output policy|result target mode|output target mode|target mode)|policy|target_mode)\s*:\s*[`"']?(?:(?:resolved|fixed|runtime|parameterized)\s+)?[`"']?(?:source-adjacent-result-artifact|source-csv-in-place|result-csv-file|session-table|local-result-csv|session-table-fallback|[a-z][a-z0-9_-]*(?:target|output|mode)[a-z0-9_-]*parameter[a-z0-9_-]*|[a-z][a-z0-9_-]*parameter[a-z0-9_-]*(?:target|output|mode)[a-z0-9_-]*)\b/iu;
const BLOCKED_SOURCE_WRITEBACK_DECLARATION_RE =
  /\b(?:blocked|unverified|insufficient|unavailable|unsupported|denied|rejected|disabled|cannot|can't|do\s+not|must\s+not|should\s+not|not\s+(?:ready|verified|available|supported|selected|used|enabled))\b[^.;\n]*\bsource-writeback\b|\bsource-writeback\b[^.;\n]*\b(?:blocked|unverified|insufficient|unavailable|unsupported|denied|rejected|disabled|cannot|can't|do\s+not|must\s+not|should\s+not|not\s+(?:ready|verified|available|supported|selected|used|enabled))\b/iu;
const BLOCKED_WRITEBACK_CAPABILITY_EVIDENCE_RE =
  /\b(?:do\s+not|must\s+not|should\s+not|cannot|can't)\b[^.;\n]*\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b|\b(?:until|before)\b[^.;\n]*\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b[^.;\n]*\b(?:verified|available|configured|enabled|ready|supported)\b|\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b[^.;\n]*\b(?:pending|provisional|tentative|awaiting|awaits?|waiting|not\s+yet)\b|\b(?:pending|provisional|tentative|awaiting|awaits?|waiting|not\s+yet)\b[^.;\n]*\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b|\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b[^.;\n]*\b(?:until|before)\b[^.;\n]*\b(?:verified|available|configured|enabled|ready|supported)\b/iu;
const REQUIRED_WRITEBACK_CAPABILITY_EVIDENCE_RE =
  /\b(?:requires?|needs?|future|will\s+require|must\s+have|must\s+use)\b[^.;\n]*\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b|\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b[^.;\n]*\b(?:requires?|needs?|required|future)\b/iu;
const FUTURE_WRITEBACK_VERIFICATION_RE =
  /\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b[^.;\n]*\b(?:will|should|must|may|might|could|to)\s+(?:be\s+)?(?:verified|confirmed|completed|tested|run|performed)\b|\b(?:will|should|must|may|might|could|to)\s+(?:be\s+)?(?:verified|confirmed|completed|tested|run|performed)\b[^.;\n]*\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b|\b(?:must|should|will|may|might|could)\s+(?:be\s+)?(?:used|selected|configured|enabled)\b[^.;\n]*\b(?:after|once|when|until|before)\b[^.;\n]*\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b[^.;\n]*\b(?:is\s+|has\s+been\s+)?(?:verified|confirmed|completed|tested|run|performed)\b|\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b[^.;\n]*\b(?:if|unless|after|once|when|until)\b[^.;\n]*\b(?:later|credentials?|access|token|auth(?:entication)?|oauth|permissions?|approval|approved|grants?|granted|sharing|enabled|added|configured|available)\b|\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b[^.;\n]*\b(?:credentials?|access|token|auth(?:entication)?|oauth|permissions?)\b[^.;\n]*\b(?:to\s+be\s+added\s+later|later|pending|future|not\s+yet)\b/iu;
const WRITEBACK_POLICY_OR_CRITERION_RE =
  /\b(?:readiness\s+criterion|criterion|policy|prerequisite|requirement)\b|\b(?:verified|passed|confirmed|completed|succeeded)\s+before\s+(?:source[-\s]?writeback|writeback)\b/iu;
const WRITEBACK_READINESS_ONLY_RE =
  /\b(?:readiness\s+criterion|criterion|prerequisite|requirement)\b|\b(?:verified|passed|confirmed|completed|succeeded)\s+before\s+(?:source[-\s]?writeback|writeback)\b/iu;
const EXPLICIT_WRITEBACK_VERIFICATION_EVIDENCE_RE =
  /\b(?:passed|verified|confirmed|completed|succeeded)\b[^.;\n]*\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b|\b(?:writeback|write[-\s]?back|record\s+update|property\s+update|page\s+property\s+update|update\s+access|write\s+access|canary)\b[^.;\n]*\b(?:passed|verified|confirmed|completed|succeeded)\b/iu;
const AFFIRMATIVE_DRY_RUN_ONLY_DECLARATION_RE =
  /\b(?:(?:(?:this|the)\s+)?(?:generated\s+)?(?:workflow|skill)\s+(?:is|remains|must\s+remain)|keeps?\s+(?:the\s+)?(?:generated\s+)?(?:workflow|skill))\s+dry[-\s]?run[-\s]?only\b/iu;
const NEGATED_DRY_RUN_ONLY_RE = /\bnot[\s_-]+dry[-\s_]?run[-\s_]?only\b/iu;
const POST_RESOLUTION_DRY_RUN_ONLY_NEGATION_RE =
  /\bnot[\s_-]+dry[-\s_]?run[-\s_]?only\b[^.;\n]*\b(?:after|once|when)\b(?=[^.;\n]*(?:onboarding|runtime\s+gate|blockers?|source|provider|auth|authentication|credentials?|route|setup))(?=[^.;\n]*(?:verified|resolved|complete|completed|passes?|ready))/iu;
const BLOCKER_SPECIFIC_DRY_RUN_ONLY_CONTEXT_RE =
  /\b(?:onboarding|blockers?|blocked|source|provider|auth|authentication|credentials?|route|setup)\b/iu;
const PROVIDER_EVIDENCE_LINE_RE =
  /(?:(?:provider\s+)?host runtime|provider_host_runtime|mcp route setup check result|provider route setup check result|mcp_route_setup_check|provider route|provider_route|provider (?:authentication|auth readiness) check result|provider auth(?:entication)?|auth_readiness|compatible MCP provider tools|compatible provider tools|compatible_tools|one[- ]off call capability|one_off_call_capability)\s*:(.*)$/iu;
const PROVIDER_HOST_RUNTIME_LINE_RE =
  /^\s*(?:[-*]\s*)?(?:(?:provider\s+)?host runtime|provider_host_runtime)\s*:/iu;
const CODEX_APP_HOST_RUNTIME_VALUE_RE =
  /^\s*codex\s+app(?:\s+automation)?[.;]?\s*$/iu;
const DISALLOWED_PROVIDER_EVIDENCE_RE =
  /(?<!\bnot\s)\binferred\b|mcp__codex_apps__|call_e_zhiwen|botlab|\bcodex\s+apps?\b|\bcall-e\s+connector\b|\bapps?\s+connector\b|\b(?:app|plugin)\s+(?:connector|tools?)(?:\s+(?:authorization|auth|tools?|route|evidence|readiness))?\b/iu;
const AFFIRMATIVE_PROVIDER_APP_EVIDENCE_RE =
  /\b(?:provider\s+onboarding|provider\s+readiness|provider\s+(?:auth(?:entication)?|checks?|results?)|call[-\s]+provider\s+(?:connection|readiness|checks?|results?)|(?:provider\s+|mcp\s+)?route(?:\s+setup(?:\s+check)?|\s+readiness)?|auth(?:entication)?\s+readiness|auth(?:entication)?|onboarding|readiness|one[- ]off\s+call\s+capability|compatible\s+(?:mcp\s+)?provider\s+tools|(?:the\s+)?checks?)\b[^.;\n]*(?:completed|passed|verified|confirmed|based\s+on|using|via)\b|\b(?:completed|passed|verified|confirmed)\s+(?:provider\s+onboarding|provider\s+readiness|provider\s+(?:auth(?:entication)?|checks?|results?)|call[-\s]+provider\s+(?:connection|readiness|checks?|results?)|(?:provider\s+|mcp\s+)?route(?:\s+setup(?:\s+check)?|\s+readiness)?|auth(?:entication)?\s+readiness|auth(?:entication)?|onboarding|readiness|(?:the\s+)?checks?)\b|\bbased\s+on\b/iu;
const PROVIDER_POLICY_PROSE_RE =
  /\b(?:do not|must not|never)\s+(?:treat|use|count|accept|infer|derive|rely\s+on)\b.*\b(?:app connector|mcp__codex_apps__|call_e_zhiwen|botlab|tools?)\b.*\b(?:evidence|proof|prove|readiness|inferred?|route)\b|\b(?:app connector|mcp__codex_apps__|call_e_zhiwen|botlab|tools?)\b.*\b(?:do not|must not|never|does not|do not)\s+(?:prove|provide|establish|verify|confirm|count\s+as)\b.*\b(?:evidence|readiness|proof|route)\b|\b(?:readiness|route|auth(?:entication)?|provider onboarding)\b.*\b(?:was|is|are|were)\s+not\s+inferred\b.*\b(?:app connector|mcp__codex_apps__|call_e_zhiwen|botlab|tools?)\b|\b(?:app connector|mcp__codex_apps__|call_e_zhiwen|botlab|tools?)\b.*\b(?:is|are|was|were)\s+not\s+(?:evidence|proof)\b/iu;
const MARKDOWN_LIST_ITEM_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/u;
const FIELD_LABEL_LINE_RE =
  /^\s*(?:(?:[-*+]\s+|\d+[.)]\s+))?[A-Za-z][A-Za-z0-9 _/-]{1,80}\s*:/u;
const RESULT_TARGET_MODE_MARKER = {
  label: "result target mode",
  patterns: [
    /^\s*(?:[-*]\s*)?(?:runtime\s+)?result target mode\s*:\s*[`"']?(?:(?:resolved|fixed|runtime|parameterized)\s+)?(?:source-writeback|source-adjacent-result-artifact|source-csv-in-place|result-csv-file|session-table|local-result-csv|session-table-fallback)\b(?!\s*(?:[`"']\s*)?\|)/imu,
    /^\s*(?:[-*]\s*)?output target mode\s*:\s*[`"']?(?:(?:resolved|fixed|runtime|parameterized)\s+)?(?:source-writeback|source-adjacent-result-artifact|source-csv-in-place|result-csv-file|session-table|local-result-csv|session-table-fallback)\b(?!\s*(?:[`"']\s*)?\|)/imu,
    /^\s*(?:[-*]\s*)?target mode\s*:\s*[`"']?(?:(?:resolved|fixed|runtime|parameterized)\s+)?(?:source-writeback|source-adjacent-result-artifact|source-csv-in-place|result-csv-file|session-table|local-result-csv|session-table-fallback)\b(?!\s*(?:[`"']\s*)?\|)/imu,
    /^\s*(?:[-*]\s*)?target_mode\s*:\s*[`"']?(?:(?:resolved|fixed|runtime|parameterized)\s+)?(?:source-writeback|source-adjacent-result-artifact|source-csv-in-place|result-csv-file|session-table|local-result-csv|session-table-fallback|[a-z][a-z0-9_-]*(?:target|output|mode)[a-z0-9_-]*parameter[a-z0-9_-]*|[a-z][a-z0-9_-]*parameter[a-z0-9_-]*(?:target|output|mode)[a-z0-9_-]*)\b(?!\s*(?:[`"']\s*)?\|)/imu,
  ],
};
const REQUIRED_SKILL_MARKERS = [
  {
    label: "purpose and when to use",
    patterns: [/purpose and when to use/iu, /when to use/iu],
  },
  {
    label: "when not to use",
    patterns: [/when not to use/iu, /do not use/iu],
  },
  {
    label: "binding level and runtime parameters",
    patterns: [/binding level/iu, /runtime parameters/iu],
  },
  {
    label: "source contract",
    patterns: [/source contract/iu],
  },
  {
    label: "candidate fields",
    patterns: [/candidate fields/iu],
  },
  {
    label: "outbound goal contract",
    patterns: [/outbound goal contract/iu],
  },
  {
    label: "MCP provider route",
    patterns: [/mcp provider route/iu],
  },
  {
    label: "provider onboarding",
    patterns: [/provider onboarding/iu],
  },
  {
    label: "execution modes",
    patterns: [/execution modes/iu],
  },
  {
    label: "serial candidate execution",
    patterns: [/serial candidate execution/iu, /serially process all ready candidates/iu],
  },
  {
    label: "provider terminal instruction scope",
    patterns: [
      /provider terminal instructions such as `?report_result`? or `?do not start another call`?\s+apply only to the current provider run/iu,
      /provider terminal instruction[\s\S]*current provider run/iu,
    ],
  },
  {
    label: "post-approval batch autonomy",
    patterns: [
      /after execution approval,\s*do not ask the\s+user to continue,\s*confirm the next candidate,\s*or approve additional provider runs/iu,
      /do not ask the\s+user to continue,\s*confirm the next candidate,\s*or approve additional provider runs/iu,
    ],
  },
  {
    label: "provider result finalization",
    patterns: [
      /provider result finalization[\s\S]*full-history provider\s+reconciliation[\s\S]*negative terminal stability check/iu,
      /terminal provider status is\s+not result-output-ready[\s\S]*full-history provider\s+reconciliation/iu,
    ],
  },
  {
    label: "result-output behavior",
    patterns: [/result-output behavior/iu, /result output behavior/iu],
  },
  RESULT_TARGET_MODE_MARKER,
  {
    label: "durable result output fallback",
    patterns: [
      /result-csv-file[\s\S]*(?:last-resort|session-table)/iu,
      /durable result output[\s\S]*session-table/iu,
    ],
  },
  {
    label: "preflight and creation summary",
    patterns: [/preflight and creation summary/iu],
  },
  {
    label: "safety summary",
    patterns: [/safety summary/iu],
  },
  {
    label: "validation commands",
    patterns: [/validation commands/iu],
  },
];
const BOUND_SOURCE_STATUS_MARKERS = [
  {
    label: "passed authentication or access check result",
    patterns: [
      /^\s*(?:source\s+)?authentication or access check result\s*:\s*([^\n]*)/imu,
      /^\s*(?:source\s+)?auth(?:entication)? check result\s*:\s*([^\n]*)/imu,
      /^\s*auth_or_access_check\s*:\s*([^\n]*)/imu,
    ],
    resultLine: true,
  },
  {
    label: "passed sample fetch result",
    patterns: [
      /^\s*sample fetch result\s*:\s*([^\n]*)/imu,
      /^\s*sample_fetch\s*:\s*([^\n]*)/imu,
    ],
    resultLine: true,
  },
];
const BOUND_SOURCE_ALWAYS_MARKERS = [
  {
    label: "source access route",
    patterns: [
      /^\s*(?:source\s+)?access route\s*:\s*([^\n]*)/imu,
      /^\s*(?:source_)?access_route\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  {
    label: "source access route discovery result",
    patterns: [
      /^\s*source access route discovery result\s*:\s*([^\n]*)/imu,
      /^\s*source_access_route_discovery_result\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  ...BOUND_SOURCE_STATUS_MARKERS,
  {
    label: "redaction policy for sample summaries",
    patterns: [
      /^\s*redaction policy(?: for sample summaries)?\s*:\s*([^\n]*)/imu,
      /^\s*redaction_policy_for_sample_summaries\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  {
    label: "runtime parameters still allowed",
    patterns: [
      /^\s*runtime parameters still allowed\s*:\s*([^\n]*)/imu,
      /^\s*runtime_parameters_still_allowed\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
    allowNone: true,
  },
];
const BOUND_SOURCE_READY_MARKERS = [
  {
    label: "sampled source instance",
    patterns: [
      /^\s*sampled source instance\s*:\s*([^\n]*)/imu,
      /^\s*sampled_source_instance\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  {
    label: "discovered field mapping",
    patterns: [
      /^\s*discovered field mapping\s*:\s*([^\n]*)/imu,
      /^\s*(?:discovered_)?field_mapping\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  {
    label: "user-confirmed field mapping",
    patterns: [
      /^\s*user-confirmed field mapping\s*:\s*([^\n]*)/imu,
      /^\s*user_confirmed_field_mapping\s*:\s*([^\n]*)/imu,
      /field mapping confirmed after (?:the )?(?:representative )?sample/iu,
    ],
    evidenceLine: true,
  },
  {
    label: "default goal contract derived from sampled fields",
    patterns: [
      /^\s*default goal contract derived from sampled fields\s*:\s*([^\n]*)/imu,
      /^\s*default_goal_source\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
];
const NOTION_PUBLIC_ROUTE_EVIDENCE_PATTERNS = [
  /^\s*(?:source\s+)?access route\s*:\s*([^\n]*)/imu,
  /^\s*(?:source_)?access_route\s*:\s*([^\n]*)/imu,
  /^\s*source access route discovery result\s*:\s*([^\n]*)/imu,
  /^\s*source_access_route_discovery_result\s*:\s*([^\n]*)/imu,
  /^\s*(?:source\s+)?authentication or access check result\s*:\s*([^\n]*)/imu,
  /^\s*(?:source\s+)?auth(?:entication)? check result\s*:\s*([^\n]*)/imu,
  /^\s*auth_or_access_check\s*:\s*([^\n]*)/imu,
  /^\s*sample fetch result\s*:\s*([^\n]*)/imu,
  /^\s*sample_fetch\s*:\s*([^\n]*)/imu,
  /^\s*sampled source instance\s*:\s*([^\n]*)/imu,
  /^\s*sampled_source_instance\s*:\s*([^\n]*)/imu,
];
const BOUND_PROVIDER_STATUS_MARKERS = [
  {
    label: "passed MCP route setup check result",
    patterns: [
      /mcp route setup check result\s*:\s*([^\n]*)/iu,
      /provider route setup check result\s*:\s*([^\n]*)/iu,
      /^\s*mcp_route_setup_check\s*:\s*([^\n]*)/imu,
    ],
    resultLine: true,
  },
  {
    label: "passed provider authentication or auth readiness check result",
    patterns: [
      /provider (?:authentication|auth readiness) check result\s*:\s*([^\n]*)/iu,
      /provider auth(?:entication)?\s*:\s*([^\n]*)/iu,
      /^\s*auth_readiness\s*:\s*([^\n]*)/imu,
    ],
    resultLine: true,
  },
];
const BOUND_PROVIDER_HOST_RUNTIME_MARKER = {
  label: "configured provider host runtime",
  patterns: [
    /provider host runtime\s*:\s*([^\n]*)/iu,
    /host runtime\s*:\s*([^\n]*)/iu,
    /^\s*provider_host_runtime\s*:\s*([^\n]*)/imu,
  ],
  evidenceLine: true,
};
const BOUND_PROVIDER_ALWAYS_MARKERS = [
  BOUND_PROVIDER_HOST_RUNTIME_MARKER,
  ...BOUND_PROVIDER_STATUS_MARKERS,
];
const BOUND_PROVIDER_ONE_OFF_CAPABILITY_MARKER = {
  label: "one-off call capability",
  patterns: [
    /one[- ]off call capability\s*:\s*([^\n]*)/iu,
    /^\s*one_off_call_capability\s*:\s*([^\n]*)/imu,
  ],
  resultLine: true,
};
const BOUND_PROVIDER_COMPATIBLE_TOOLS_MARKER = {
  label: "compatible MCP provider tools",
  patterns: [
    /compatible MCP provider tools\s*:\s*([^\n]*)/iu,
    /compatible provider tools\s*:\s*([^\n]*)/iu,
    /^\s*compatible_tools\s*:\s*([^\n]*)/imu,
  ],
  evidenceLine: true,
  requireConcreteEvidence: true,
  collectContinuation: true,
  concreteEvidencePattern:
    /(?:^|[^A-Za-z0-9])(?:plan[_ -]?call|run[_ -]?call|get[_ -]?call[_ -]?run|get[_ -]?run|status[_ -]?check|call[_ -]?status)\b/iu,
  concreteEvidencePatterns: [
    /(?:^|[^A-Za-z0-9])plan[_ -]?call\b/iu,
    /(?:^|[^A-Za-z0-9])run[_ -]?call\b/iu,
    /(?:^|[^A-Za-z0-9])(?:get[_ -]?call[_ -]?run|get[_ -]?run|status[_ -]?check|call[_ -]?status)\b/iu,
  ],
  blockedEvidencePattern:
    /(?:^|[^A-Za-z0-9])(?:plan[_ -]?call|run[_ -]?call|get[_ -]?call[_ -]?run|get[_ -]?run|status[_ -]?check|call[_ -]?status)\b[^.;\n]*\b(?:missing|unavailable|not available|unsupported|not ready|not configured|blocked|disabled)\b|\b(?:missing|unavailable|not available|unsupported|not ready|not configured|blocked|disabled)\b[^.;\n]*(?:^|[^A-Za-z0-9])(?:plan[_ -]?call|run[_ -]?call|get[_ -]?call[_ -]?run|get[_ -]?run|status[_ -]?check|call[_ -]?status)\b/iu,
};
const BOUND_PROVIDER_READY_MARKERS = [
  BOUND_PROVIDER_COMPATIBLE_TOOLS_MARKER,
  BOUND_PROVIDER_ONE_OFF_CAPABILITY_MARKER,
];
const BOUND_PROVIDER_BLOCKING_STATUS_MARKERS = [
  BOUND_PROVIDER_HOST_RUNTIME_MARKER,
  ...BOUND_PROVIDER_STATUS_MARKERS,
  BOUND_PROVIDER_COMPATIBLE_TOOLS_MARKER,
  BOUND_PROVIDER_ONE_OFF_CAPABILITY_MARKER,
];
const PROVIDER_BLOCKER_PATTERNS = [
  /^\s*provider onboarding blocker\s*:\s*([^\n]*)/imu,
  /^\s*provider_onboarding_blocker\s*:\s*([^\n]*)/imu,
];
const EMPTY_BLOCKER_RE = /^(?:none|n\/a|na|not applicable|no blockers?)$/iu;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing file: ${filePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseFrontmatter(text, filePath) {
  const opening = /^---\r?\n/.exec(text);
  if (!opening) {
    fail(`Missing YAML frontmatter: ${filePath}`);
    return {};
  }

  const end = text.indexOf("\n---", opening[0].length);
  if (end === -1) {
    fail(`Unterminated YAML frontmatter: ${filePath}`);
    return {};
  }

  const result = {};
  const block = text.slice(opening[0].length, end).trim();
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      fail(`Invalid frontmatter line in ${filePath}: ${line}`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^[\u2019'"]|[\u2019'"]$/g, "");
    result[key] = value;
  }
  return result;
}

function walkTextFiles(dirPath) {
  const files = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTextFiles(fullPath));
      continue;
    }
    if (/\.(md|mjs|json|yaml|yml|txt)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseArgs(argv) {
  const args = { skillDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skill-dir") {
      args.skillDir = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

function extractRequiredValue(text, pattern, label) {
  const match = pattern.exec(text);
  if (!match) {
    fail(`Generated skill SKILL.md must declare a selected ${label}`);
    return "";
  }
  return match[1].toLowerCase();
}

function extractSection(text, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\r?\\n)##[ \\t]+${escapedHeading}[ \\t]*(?:\\r?\\n|$)` +
      `([\\s\\S]*?)(?=\\r?\\n##[ \\t]+|$)`,
    "iu",
  );
  const match = pattern.exec(text);
  return match ? match[1] : "";
}

function extractAllSections(text, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\r?\\n)##[ \\t]+${escapedHeading}[ \\t]*(?:\\r?\\n|$)` +
      `([\\s\\S]*?)(?=\\r?\\n##[ \\t]+|$)`,
    "igu",
  );
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function extractSections(text, headings) {
  const sectionTexts = [];
  for (const heading of headings) {
    for (const sectionText of extractAllSections(text, heading)) {
      if (sectionText.trim()) {
        sectionTexts.push(sectionText);
      }
    }
  }
  return sectionTexts.join("\n");
}

function getDryRunOnlyDeclarationState(textSegments) {
  let hasAffirmativeDeclaration = false;
  let hasNegatedDeclaration = false;
  for (const textSegment of textSegments) {
    for (const line of textSegment.split(/\r?\n/u)) {
      if (
        NEGATED_DRY_RUN_ONLY_RE.test(line) &&
        !POST_RESOLUTION_DRY_RUN_ONLY_NEGATION_RE.test(line)
      ) {
        hasNegatedDeclaration = true;
        continue;
      }
      if (
        AFFIRMATIVE_DRY_RUN_ONLY_DECLARATION_RE.test(line) &&
        BLOCKER_SPECIFIC_DRY_RUN_ONLY_CONTEXT_RE.test(line)
      ) {
        hasAffirmativeDeclaration = true;
      }
    }
  }
  return { hasAffirmativeDeclaration, hasNegatedDeclaration };
}

function hasPublicNotionReadRouteEvidence(sourceOnboardingText) {
  for (const pattern of NOTION_PUBLIC_ROUTE_EVIDENCE_PATTERNS) {
    for (const match of findPatternMatches(sourceOnboardingText, pattern)) {
      const routeEvidence = (match[1] || "").replace(
        NEGATED_PUBLIC_NOTION_READ_ROUTE_RE,
        " ",
      );
      if (PUBLIC_NOTION_READ_ROUTE_RE.test(routeEvidence)) {
        return true;
      }
    }
  }
  return false;
}

function hasAuthenticatedNotionWritebackEvidence(sourceOnboardingText) {
  let hasAuthenticatedRouteEvidence = false;
  let hasVerifiedWritebackEvidence = false;
  for (const line of sourceOnboardingText.split(/\r?\n/u)) {
    const hasRouteEvidenceContext =
      AUTHENTICATED_NOTION_ROUTE_EVIDENCE_CONTEXT_RE.test(line);
    const routeEvidence = line.replace(
      NEGATED_AUTHENTICATED_NOTION_WRITEBACK_RE,
      " ",
    ).replace(
      NEGATED_AUTHENTICATED_NOTION_ROUTE_RE,
      " ",
    );
    for (const clause of splitEvidenceClauses(routeEvidence)) {
      const hasVerifiedWritebackEvidenceInClause =
        AUTHENTICATED_NOTION_WRITEBACK_RE.test(clause) &&
        !PUBLIC_NOTION_WRITEBACK_ROUTE_RE.test(clause);
      if (
        isBlockedWritebackCapabilityEvidence(clause) ||
        REQUIRED_WRITEBACK_CAPABILITY_EVIDENCE_RE.test(clause) ||
        FUTURE_WRITEBACK_VERIFICATION_RE.test(clause) ||
        (WRITEBACK_POLICY_OR_CRITERION_RE.test(clause) &&
          (!hasVerifiedWritebackEvidenceInClause ||
            WRITEBACK_READINESS_ONLY_RE.test(clause)))
      ) {
        continue;
      }
      if (
        (hasRouteEvidenceContext || hasVerifiedWritebackEvidenceInClause) &&
        AUTHENTICATED_NOTION_WRITEBACK_ROUTE_RE.test(clause) &&
        !NOTION_AUTH_ROUTE_CREDENTIAL_WARNING_RE.test(clause)
      ) {
        hasAuthenticatedRouteEvidence = true;
      }
      if (hasVerifiedWritebackEvidenceInClause) {
        hasVerifiedWritebackEvidence = true;
      }
      if (hasAuthenticatedRouteEvidence && hasVerifiedWritebackEvidence) {
        return true;
      }
    }
  }
  return false;
}

function splitEvidenceClauses(text) {
  return text
    .split(
      /(?<=[;.!?])\s+|\s+\b(?:but|however|because|while|although)\b\s+|\s+\band\b\s+(?=(?:provider\s+onboarding|provider\s+(?:auth(?:entication)?|checks?|results?)|call[-\s]+provider\s+(?:connection|readiness|checks?|results?)|(?:provider\s+|mcp\s+)?route\s+setup|route\s+readiness|auth(?:entication)?\s+readiness|auth(?:entication)?|onboarding|readiness)\b)|,\s+(?=(?:provider\s+onboarding|provider\s+(?:auth(?:entication)?|checks?|results?)|call[-\s]+provider\s+(?:connection|readiness|checks?|results?)|(?:provider\s+|mcp\s+)?route\s+setup|route\s+readiness|auth(?:entication)?\s+readiness|auth(?:entication)?|onboarding|readiness)\b)/iu,
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function hasNotionAccessRouteEvidence(sourceOnboardingText) {
  for (const pattern of NOTION_PUBLIC_ROUTE_EVIDENCE_PATTERNS) {
    for (const match of findPatternMatches(sourceOnboardingText, pattern)) {
      if (NOTION_ACCESS_ROUTE_RE.test(match[1] || "")) {
        return true;
      }
    }
  }
  return false;
}

function hasReadOnlyAirtableAccessEvidence(sourceOnboardingText) {
  for (const pattern of NOTION_PUBLIC_ROUTE_EVIDENCE_PATTERNS) {
    for (const match of findPatternMatches(sourceOnboardingText, pattern)) {
      const routeEvidence = (match[1] || "").replace(
        NEGATED_READ_ONLY_AIRTABLE_ROUTE_RE,
        " ",
      ).replace(
        NEGATED_AIRTABLE_WRITE_CAPABILITY_RE,
        " ",
      );
      if (READ_ONLY_AIRTABLE_ROUTE_RE.test(routeEvidence)) {
        return true;
      }
    }
  }
  return false;
}

function hasVerifiedAirtableWriteCapabilityEvidence(sourceOnboardingText) {
  for (const line of sourceOnboardingText.split(/\r?\n/u)) {
    const routeEvidence = line.replace(
      NEGATED_AIRTABLE_WRITE_CAPABILITY_RE,
      " ",
    );
    for (const clause of splitEvidenceClauses(routeEvidence)) {
      const hasVerifiedWriteCapabilityInClause =
        VERIFIED_AIRTABLE_WRITE_CAPABILITY_RE.test(clause);
      if (
        isBlockedWritebackCapabilityEvidence(clause) ||
        REQUIRED_WRITEBACK_CAPABILITY_EVIDENCE_RE.test(clause) ||
        FUTURE_WRITEBACK_VERIFICATION_RE.test(clause) ||
        (WRITEBACK_POLICY_OR_CRITERION_RE.test(clause) &&
          (!hasVerifiedWriteCapabilityInClause ||
            WRITEBACK_READINESS_ONLY_RE.test(clause))) ||
        (UNVERIFIED_AIRTABLE_WRITE_CAPABILITY_RE.test(clause) &&
          !EXPLICIT_AIRTABLE_WRITE_VERIFICATION_RE.test(clause))
      ) {
        continue;
      }
      if (hasVerifiedWriteCapabilityInClause) {
        return true;
      }
    }
  }
  return false;
}

function hasAirtableAccessRouteEvidence(sourceOnboardingText) {
  for (const pattern of NOTION_PUBLIC_ROUTE_EVIDENCE_PATTERNS) {
    for (const match of findPatternMatches(sourceOnboardingText, pattern)) {
      if (AIRTABLE_ACCESS_ROUTE_RE.test(match[1] || "")) {
        return true;
      }
    }
  }
  return false;
}

function hasActiveSourceWritebackDeclaration(text) {
  const lines = text.split(/\r?\n/u);
  let inFence = false;
  let hasNonFencedResultModeDeclaration = false;
  let hasFencedSourceWritebackDeclaration = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(?:```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!SOURCE_WRITEBACK_RESULT_MODE_RE.test(line)) {
      if (!inFence && NON_WRITEBACK_RESULT_MODE_RE.test(line)) {
        hasNonFencedResultModeDeclaration = true;
      }
      continue;
    }
    if (isBlockedSourceWritebackDeclaration(line)) {
      continue;
    }
    if (inFence) {
      hasFencedSourceWritebackDeclaration = true;
      continue;
    }
    return true;
  }
  return !hasNonFencedResultModeDeclaration && hasFencedSourceWritebackDeclaration;
}

function isBlockedSourceWritebackDeclaration(line) {
  return line
    .split(/[;,]/u)
    .some(
      (clause) =>
        /\bsource-writeback\b/iu.test(clause) &&
        BLOCKED_SOURCE_WRITEBACK_DECLARATION_RE.test(clause),
    );
}

function isBlockedWritebackCapabilityEvidence(text) {
  if (
    BLOCKED_WRITEBACK_CAPABILITY_EVIDENCE_RE.test(text) ||
    FUTURE_WRITEBACK_VERIFICATION_RE.test(text)
  ) {
    return true;
  }
  return (
    REQUIRED_WRITEBACK_CAPABILITY_EVIDENCE_RE.test(text) &&
    !EXPLICIT_WRITEBACK_VERIFICATION_EVIDENCE_RE.test(text)
  );
}

function withGlobalFlag(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function* findPatternMatches(text, pattern) {
  const globalPattern = withGlobalFlag(pattern);
  for (const line of text.split(/\r?\n/u)) {
    globalPattern.lastIndex = 0;
    yield* line.matchAll(globalPattern);
  }
}

function shouldCollectMarkerContinuation(evidenceValue) {
  const normalizedEvidenceValue = evidenceValue.trim();
  return !normalizedEvidenceValue || !/[.!?]\s*$/u.test(normalizedEvidenceValue);
}

function* findMarkerMatches(text, pattern, marker) {
  if (!marker.collectContinuation) {
    yield* findPatternMatches(text, pattern);
    return;
  }
  const globalPattern = withGlobalFlag(pattern);
  const lines = text.split(/\r?\n/u);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    globalPattern.lastIndex = 0;
    for (const match of lines[lineIndex].matchAll(globalPattern)) {
      const evidenceParts = [];
      const inlineEvidenceValue = (match[1] || "").trim();
      if (inlineEvidenceValue) {
        evidenceParts.push(inlineEvidenceValue);
      }
      let collectedEvidenceValue = inlineEvidenceValue;
      for (
        let continuationIndex = lineIndex + 1;
        continuationIndex < lines.length;
        continuationIndex += 1
      ) {
        const continuationLine = lines[continuationIndex];
        const isNestedContinuation =
          isNestedProviderEvidenceContinuationLine(continuationLine);
        if (
          !isNestedContinuation &&
          !shouldCollectMarkerContinuation(collectedEvidenceValue)
        ) {
          break;
        }
        if (
          !isProviderEvidenceContinuationLine(
            continuationLine,
            Boolean(collectedEvidenceValue.trim()),
          )
        ) {
          break;
        }
        const continuationEvidenceValue = continuationLine
          .replace(MARKDOWN_LIST_ITEM_RE, "")
          .trim();
        evidenceParts.push(continuationEvidenceValue);
        collectedEvidenceValue = evidenceParts.join(" ");
      }
      const continuationMatch = Array.from(match);
      continuationMatch.index = match.index;
      continuationMatch.input = match.input;
      continuationMatch.groups = match.groups;
      continuationMatch[1] = evidenceParts.join(" ");
      yield continuationMatch;
    }
  }
}

function normalizeStatusText(text) {
  return text.trim().replace(/[_-]+/gu, " ");
}

function isExplicitBlockingStatusExpression(text, { allowStatusObjects = false } = {}) {
  const normalizedText = normalizeStatusText(text);
  const blockingStatusMatch = BLOCKING_STATUS_TOKEN_RE.exec(normalizedText);
  if (blockingStatusMatch) {
    const rest = normalizedText.slice(blockingStatusMatch[0].length).trim();
    if (
      !rest ||
      /^[.;:,)]/u.test(rest) ||
      STATUS_REASON_PREFIX_RE.test(rest) ||
      (allowStatusObjects && STATUS_EVIDENCE_OBJECT_RE.test(rest))
    ) {
      return true;
    }
  }
  return (
    BLOCKING_STATUS_VERB_PHRASE_RE.test(normalizedText) ||
    BLOCKING_STATUS_OBJECT_PHRASE_RE.test(normalizedText)
  );
}

function getPostPassStatusClauses(text) {
  const clauses = [];
  const contrastMatch = /\b(?:but|however|yet|though|although|except)\b([\s\S]*)/iu.exec(text);
  if (contrastMatch) {
    clauses.push(contrastMatch[1]);
  }
  clauses.push(...text.split(/[.;]/u).slice(1));
  return clauses.map((clause) => clause.trim()).filter(Boolean);
}

function hasContradictoryPostPassStatus(text) {
  const inlineEvidenceText = text.replace(AFFIRMATIVE_PASS_RESULT_RE, "").trim();
  if (
    REQUIRED_ACTION_STATUS_RESULT_RE.test(inlineEvidenceText) ||
    INLINE_NEGATIVE_READY_EVIDENCE_RE.test(inlineEvidenceText) ||
    isExplicitBlockingStatusExpression(inlineEvidenceText, { allowStatusObjects: true })
  ) {
    return true;
  }
  return getPostPassStatusClauses(text).some(
    (clause) =>
      isExplicitBlockingStatusExpression(clause, { allowStatusObjects: true }) ||
      REQUIRED_ACTION_STATUS_RESULT_RE.test(clause),
  );
}

function classifyOnboardingStatusLine(statusLine, allowBlockedStatus) {
  const normalizedStatusLine = statusLine.trim();
  const normalizedBlockingStatusLine = normalizeStatusText(normalizedStatusLine);
  if (/\bplaceholder\b/iu.test(normalizedStatusLine)) {
    return "";
  }
  if (AFFIRMATIVE_PASS_RESULT_RE.test(normalizedStatusLine)) {
    const actionableStatusLine = normalizedBlockingStatusLine.replace(
      NO_REQUIRED_ACTION_STATUS_RESULT_RE,
      " ",
    );
    if (hasContradictoryPostPassStatus(actionableStatusLine)) {
      return "conflicted";
    }
    return "passed";
  }
  if (
    allowBlockedStatus &&
    (NEGATED_PASS_RESULT_RE.test(normalizedStatusLine) ||
      isExplicitBlockingStatusExpression(normalizedBlockingStatusLine, {
        allowStatusObjects: true,
      }))
  ) {
    return "blocked";
  }
  return "";
}

function classifyEvidenceValueLine(evidenceValue, allowBlockedStatus, marker = {}) {
  const normalizedEvidenceValue = evidenceValue.trim();
  const normalizedBlockingEvidenceValue = normalizeStatusText(normalizedEvidenceValue);
  if (!normalizedEvidenceValue || /\bplaceholder\b/iu.test(normalizedEvidenceValue)) {
    return "";
  }
  if (marker.blockedEvidencePattern?.test(normalizedEvidenceValue)) {
    return allowBlockedStatus ? "blocked" : "";
  }
  if (
    marker.requireConcreteEvidence &&
    !marker.concreteEvidencePattern?.test(normalizedEvidenceValue)
  ) {
    return allowBlockedStatus ? "blocked" : "";
  }
  if (
    marker.concreteEvidencePatterns?.length &&
    !marker.concreteEvidencePatterns.every((pattern) => pattern.test(normalizedEvidenceValue))
  ) {
    return allowBlockedStatus ? "blocked" : "";
  }
  if (
    !marker.allowNone &&
    !NO_EXTRA_EVIDENCE_REQUIRED_RE.test(normalizedEvidenceValue) &&
    !NO_CHANGE_CONFIRMATION_RE.test(normalizedEvidenceValue) &&
    (EMPTY_EVIDENCE_RESULT_RE.test(normalizedEvidenceValue) ||
      NO_EVIDENCE_RESULT_RE.test(normalizedEvidenceValue))
  ) {
    return allowBlockedStatus ? "blocked" : "";
  }
  if (
    NEGATED_PASS_RESULT_RE.test(normalizedEvidenceValue) ||
    isExplicitBlockingStatusExpression(normalizedBlockingEvidenceValue)
  ) {
    return allowBlockedStatus ? "blocked" : "";
  }
  return "passed";
}

function classifyMarkerMatch(marker, match, allowBlockedStatus) {
  if (marker.resultLine) {
    return classifyOnboardingStatusLine(match[1] || "", allowBlockedStatus);
  }
  if (marker.evidenceLine) {
    if (match.length < 2) {
      return "passed";
    }
    return classifyEvidenceValueLine(match[1] || "", allowBlockedStatus, marker);
  }
  return "";
}

function getOnboardingStatus(text, marker, allowBlockedStatus) {
  if (!marker.resultLine && !marker.evidenceLine) {
    return "";
  }
  let seenPassedStatus = false;
  let seenBlockedStatus = false;
  for (const pattern of marker.patterns) {
    for (const match of findMarkerMatches(text, pattern, marker)) {
      const status = classifyMarkerMatch(marker, match, allowBlockedStatus);
      if (status === "passed") {
        seenPassedStatus = true;
      }
      if (status === "blocked") {
        seenBlockedStatus = true;
      }
      if (status === "conflicted") {
        fail(`Generated skill SKILL.md has contradictory ${marker.label} line`);
        return "";
      }
    }
  }
  if (seenPassedStatus && seenBlockedStatus) {
    fail(`Generated skill SKILL.md has conflicting ${marker.label} lines`);
    return "";
  }
  if (seenPassedStatus) {
    return "passed";
  }
  if (seenBlockedStatus) {
    return "blocked";
  }
  return "";
}

function hasAcceptedOnboardingStatusLine(text, statusLinePattern, allowBlockedStatus) {
  for (const match of findPatternMatches(text, statusLinePattern)) {
    if (classifyOnboardingStatusLine(match[1] || "", allowBlockedStatus)) {
      return true;
    }
  }
  return false;
}

function hasAcceptedEvidenceLine(text, marker, evidenceLinePattern, allowBlockedStatus) {
  for (const match of findMarkerMatches(text, evidenceLinePattern, marker)) {
    if (classifyMarkerMatch(marker, match, allowBlockedStatus)) {
      return true;
    }
  }
  return false;
}

function hasMarkerWithAllowedStatus(text, marker, allowBlockedStatus) {
  for (const pattern of marker.patterns) {
    if (marker.resultLine) {
      if (hasAcceptedOnboardingStatusLine(text, pattern, allowBlockedStatus)) {
        return true;
      }
      continue;
    }
    if (marker.evidenceLine) {
      if (hasAcceptedEvidenceLine(text, marker, pattern, allowBlockedStatus)) {
        return true;
      }
      continue;
    }
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

function failOnConflictingStatusLines(text, markers) {
  for (const marker of markers) {
    getOnboardingStatus(text, marker, true);
  }
}

function requireMarkerGroup(text, markers, allowBlockedStatus, messagePrefix) {
  for (const marker of markers) {
    if (!hasMarkerWithAllowedStatus(text, marker, allowBlockedStatus)) {
      fail(`${messagePrefix} ${marker.label}`);
    }
  }
}

function validateBoundSourceOnboarding(sourceOnboardingText) {
  failOnConflictingStatusLines(sourceOnboardingText, [
    ...BOUND_SOURCE_ALWAYS_MARKERS,
    ...BOUND_SOURCE_READY_MARKERS,
  ]);
  requireMarkerGroup(
    sourceOnboardingText,
    BOUND_SOURCE_ALWAYS_MARKERS,
    false,
    "Bound generated skill SKILL.md must include",
  );
  requireMarkerGroup(
    sourceOnboardingText,
    BOUND_SOURCE_READY_MARKERS,
    false,
    "Bound generated skill SKILL.md must include",
  );
}

function validateBoundProviderOnboarding(providerOnboardingText, allowsBlockedOnboarding) {
  failOnConflictingStatusLines(providerOnboardingText, [
    ...BOUND_PROVIDER_ALWAYS_MARKERS,
    ...BOUND_PROVIDER_READY_MARKERS,
  ]);
  const providerOnboardingStatuses = BOUND_PROVIDER_BLOCKING_STATUS_MARKERS.map((marker) =>
    getOnboardingStatus(providerOnboardingText, marker, allowsBlockedOnboarding),
  );
  const providerBlockerState = getBlockerState(
    providerOnboardingText,
    PROVIDER_BLOCKER_PATTERNS,
  );
  const hasProviderOnboardingBlocker = providerBlockerState.hasNonEmpty;
  if (hasProviderOnboardingBlocker && !allowsBlockedOnboarding) {
    fail("Provider onboarding blocker conflicts with real-call-ready provider onboarding");
  }
  const hasBlockedProviderOnboarding =
    providerOnboardingStatuses.includes("blocked") || hasProviderOnboardingBlocker;
  requireMarkerGroup(
    providerOnboardingText,
    BOUND_PROVIDER_ALWAYS_MARKERS,
    allowsBlockedOnboarding,
    "Bound generated skill SKILL.md must include",
  );
  if (hasBlockedProviderOnboarding) {
    if (
      !providerBlockerState.hasNonEmpty ||
      providerBlockerState.hasEmpty ||
      providerBlockerState.hasNone
    ) {
      fail(
        "Dry-run-only blocked provider onboarding must include a non-empty provider onboarding blocker",
      );
    }
    const passedReadyMarker = BOUND_PROVIDER_READY_MARKERS.find(
      (marker) => getOnboardingStatus(providerOnboardingText, marker, true) === "passed",
    );
    if (passedReadyMarker) {
      fail(
        `Dry-run-only blocked provider onboarding must not include passed ${passedReadyMarker.label}`,
      );
    }
    return;
  }
  requireMarkerGroup(
    providerOnboardingText,
    BOUND_PROVIDER_READY_MARKERS,
    allowsBlockedOnboarding,
    "Bound generated skill SKILL.md must include",
  );
}

function hasNonEmptyBlocker(text, blockerPatterns) {
  return getBlockerState(text, blockerPatterns).hasNonEmpty;
}

function getBlockerState(text, blockerPatterns) {
  const state = {
    hasEmpty: false,
    hasNone: false,
    hasNonEmpty: false,
  };
  for (const pattern of blockerPatterns) {
    for (const match of findPatternMatches(text, pattern)) {
      const blockerValue = (match[1] || "").trim().replace(/[.;]+$/u, "").trim();
      if (!blockerValue) {
        state.hasEmpty = true;
        continue;
      }
      if (EMPTY_BLOCKER_RE.test(blockerValue)) {
        state.hasNone = true;
        continue;
      }
      state.hasNonEmpty = true;
    }
  }
  return state;
}

function hasDisallowedProviderEvidence(text, { scanFreeFormEvidence = false } = {}) {
  const lines = text.split(/\r?\n/u);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const providerEvidenceMatch = PROVIDER_EVIDENCE_LINE_RE.exec(line);
    if (
      scanFreeFormEvidence &&
      !providerEvidenceMatch &&
      hasDisallowedFreeFormProviderEvidence(lines, lineIndex)
    ) {
      return true;
    }
    if (!providerEvidenceMatch) {
      continue;
    }
    const providerEvidenceValue = providerEvidenceMatch[1] || "";
    const isAllowedCodexAppHostRuntime =
      PROVIDER_HOST_RUNTIME_LINE_RE.test(line) &&
      CODEX_APP_HOST_RUNTIME_VALUE_RE.test(providerEvidenceValue);
    if (
      DISALLOWED_PROVIDER_EVIDENCE_RE.test(line) &&
      !isAllowedCodexAppHostRuntime &&
      !isBlockedDisallowedProviderEvidence(providerEvidenceValue || line)
    ) {
      return true;
    }
    const hasSameLineValue = Boolean(providerEvidenceValue.trim());
    for (
      let continuationIndex = lineIndex + 1;
      continuationIndex < lines.length;
      continuationIndex += 1
    ) {
      const continuationLine = lines[continuationIndex];
      if (
        isNestedProviderEvidenceContinuationLine(continuationLine) &&
        DISALLOWED_PROVIDER_EVIDENCE_RE.test(continuationLine) &&
        !isBlockedDisallowedProviderEvidence(continuationLine)
      ) {
        return true;
      }
      if (!isProviderEvidenceContinuationLine(continuationLine, hasSameLineValue)) {
        break;
      }
      if (
        DISALLOWED_PROVIDER_EVIDENCE_RE.test(continuationLine) &&
        !isBlockedDisallowedProviderEvidence(continuationLine)
      ) {
        return true;
      }
    }
  }
  return false;
}

function isBlockedDisallowedProviderEvidence(text) {
  return classifyOnboardingStatusLine(text.replace(MARKDOWN_LIST_ITEM_RE, ""), true) === "blocked";
}

function hasDisallowedFreeFormProviderEvidence(lines, lineIndex) {
  const line = lines[lineIndex];
  if (!DISALLOWED_PROVIDER_EVIDENCE_RE.test(line)) {
    return false;
  }
  if (isBlockedDisallowedProviderEvidence(line)) {
    return false;
  }
  if (/provider[_\s-]+onboarding[_\s-]+blocker\s*:/iu.test(line)) {
    return false;
  }
  const lineWithContinuation = getFreeFormProviderEvidenceContext(lines, lineIndex);
  return hasUnapprovedDisallowedProviderEvidence(lineWithContinuation);
}

function hasUnapprovedDisallowedProviderEvidence(text) {
  return splitEvidenceClauses(text).some((clause) => {
    if (!DISALLOWED_PROVIDER_EVIDENCE_RE.test(clause)) {
      return false;
    }
    if (AFFIRMATIVE_PROVIDER_APP_EVIDENCE_RE.test(clause)) {
      return true;
    }
    return !PROVIDER_POLICY_PROSE_RE.test(clause);
  });
}

function getFreeFormProviderEvidenceContext(lines, lineIndex) {
  let context = lines[lineIndex];
  for (let previousIndex = lineIndex - 1; previousIndex >= 0; previousIndex -= 1) {
    const previousLine = lines[previousIndex];
    if (!isPreviousFreeFormPolicyContinuationLine(previousLine)) {
      break;
    }
    context = `${previousLine.trim()} ${context.trimStart()}`;
  }
  for (
    let continuationIndex = lineIndex + 1;
    continuationIndex < lines.length;
    continuationIndex += 1
  ) {
    const continuationLine = lines[continuationIndex];
    if (!isFreeFormPolicyContinuationLine(continuationLine, context)) {
      break;
    }
    context = `${context.trimEnd()} ${continuationLine.trim()}`;
  }
  return context;
}

function isPreviousFreeFormPolicyContinuationLine(line) {
  if (!line.trim()) {
    return false;
  }
  if (/^\s*#{1,6}\s/u.test(line)) {
    return false;
  }
  if (PROVIDER_EVIDENCE_LINE_RE.test(line)) {
    return false;
  }
  return !/[.!?]\s*$/u.test(line.trim());
}

function isFreeFormPolicyContinuationLine(line, previousText) {
  if (!line.trim()) {
    return false;
  }
  if (/^\s*#{1,6}\s/u.test(line)) {
    return false;
  }
  if (
    PROVIDER_EVIDENCE_LINE_RE.test(line) ||
    FIELD_LABEL_LINE_RE.test(line) ||
    MARKDOWN_LIST_ITEM_RE.test(line)
  ) {
    return false;
  }
  return !/[.!?]\s*$/u.test(previousText.trim());
}

function isProviderEvidenceContinuationLine(line, previousLineHasValue) {
  if (!line.trim()) {
    return false;
  }
  if (/^\s*#{1,6}\s/u.test(line)) {
    return false;
  }
  if (isNestedProviderEvidenceContinuationLine(line)) {
    return true;
  }
  if (PROVIDER_EVIDENCE_LINE_RE.test(line) || FIELD_LABEL_LINE_RE.test(line)) {
    return false;
  }
  if (!previousLineHasValue) {
    return true;
  }
  return (
    /^[a-z`"'([{]/u.test(line.trim()) ||
    DISALLOWED_PROVIDER_EVIDENCE_RE.test(line)
  );
}

function isNestedProviderEvidenceContinuationLine(line) {
  return MARKDOWN_LIST_ITEM_RE.test(line) || /^\s{2,}\S/u.test(line);
}

const args = parseArgs(process.argv.slice(2));
if (!args.skillDir) {
  fail("Usage: check-generated-skill.mjs --skill-dir <path>");
  process.exit();
}

const skillDir = path.resolve(args.skillDir);
const skillName = path.basename(skillDir);
const skillMd = path.join(skillDir, "SKILL.md");
const safetyMd = path.join(skillDir, "references", "safety.md");
const examplesMd = path.join(skillDir, "references", "examples.md");

if (!SLUG_RE.test(skillName)) {
  fail(`Skill directory is not a lowercase slug: ${skillName}`);
}

const skillText = readText(skillMd);
const frontmatter = parseFrontmatter(skillText, skillMd);
const frontmatterKeys = Object.keys(frontmatter);

if (
  frontmatterKeys.some((key) => !["name", "description"].includes(key)) ||
  !frontmatterKeys.includes("name") ||
  !frontmatterKeys.includes("description")
) {
  fail("Generated skill frontmatter must include only name and description");
}

if (frontmatter.name !== skillName) {
  fail(`Skill name '${frontmatter.name || ""}' must match directory '${skillName}'`);
}

if (!frontmatter.description || frontmatter.description.length < 40) {
  fail("Skill description must be at least 40 characters");
}

if (!/phone|call/iu.test(frontmatter.description || "")) {
  fail("Skill description must mention phone or call workflow");
}

for (const marker of REQUIRED_SKILL_MARKERS) {
  if (!marker.patterns.some((pattern) => pattern.test(skillText))) {
    fail(`Generated skill SKILL.md must include ${marker.label}`);
  }
}

if (!/source onboarding/iu.test(skillText)) {
  fail("Generated skill SKILL.md must include source onboarding");
}

const bindingLevelText = extractSection(skillText, "Binding Level and Runtime Parameters");
const sourceOnboardingText = extractSections(skillText, [
  "Source Onboarding",
  "Source Onboarding Contract",
]);
const providerOnboardingText = extractSections(skillText, [
  "Provider Onboarding",
  "Provider Onboarding Contract",
]);
const executionModesText = extractSection(skillText, "Execution Modes");
const resultOutputText = extractSections(skillText, [
  "Result-Output Behavior",
  "Result Output Behavior",
  "Result Output Contract",
]);
requireMarkerGroup(
  resultOutputText,
  [RESULT_TARGET_MODE_MARKER],
  false,
  "Generated skill result-output section must include",
);
const safetySummaryText = extractSection(skillText, "Safety Summary");
const selectedBindingLevel = extractRequiredValue(
  bindingLevelText,
  BINDING_LEVEL_RE,
  "binding level",
);
const selectedExecutionMode = extractRequiredValue(
  executionModesText,
  EXECUTION_MODE_RE,
  "execution mode",
);
const dryRunOnlyDeclarationState = getDryRunOnlyDeclarationState([
  executionModesText,
  sourceOnboardingText,
  providerOnboardingText,
  safetySummaryText,
]);
const allowsBlockedOnboarding =
  selectedExecutionMode === "dry-run-then-batch-approval" &&
  dryRunOnlyDeclarationState.hasAffirmativeDeclaration &&
  !dryRunOnlyDeclarationState.hasNegatedDeclaration;

if (["fully-bound", "parameterized-bound"].includes(selectedBindingLevel)) {
  const hasActiveSourceWriteback = hasActiveSourceWritebackDeclaration(resultOutputText);
  const isNotionSourceFamily =
    NOTION_SOURCE_FAMILY_RE.test(skillText) ||
    hasNotionAccessRouteEvidence(sourceOnboardingText);
  const isAirtableSourceFamily =
    AIRTABLE_SOURCE_FAMILY_RE.test(skillText) ||
    hasAirtableAccessRouteEvidence(sourceOnboardingText);
  const writebackEvidenceText = `${sourceOnboardingText}\n${resultOutputText}`;
  if (
    isNotionSourceFamily &&
    hasPublicNotionReadRouteEvidence(sourceOnboardingText) &&
    !hasAuthenticatedNotionWritebackEvidence(writebackEvidenceText) &&
    hasActiveSourceWriteback
  ) {
    fail(
      "Generated Notion skills cannot mark source writeback ready from public shared-page access; use hosted Notion MCP, another authenticated Notion writeback route, or a local result CSV fallback",
    );
  }
  if (
    isNotionSourceFamily &&
    !hasAuthenticatedNotionWritebackEvidence(writebackEvidenceText) &&
    hasActiveSourceWriteback
  ) {
    fail(
      "Generated Notion skills cannot mark source writeback ready without verified authenticated Notion writeback evidence",
    );
  }
  if (
    isAirtableSourceFamily &&
    hasReadOnlyAirtableAccessEvidence(sourceOnboardingText) &&
    !hasVerifiedAirtableWriteCapabilityEvidence(writebackEvidenceText) &&
    hasActiveSourceWriteback
  ) {
    fail(
      "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access; use hosted Airtable MCP, another authenticated Airtable writeback route, or a local result CSV fallback",
    );
  }
  if (
    isAirtableSourceFamily &&
    !hasVerifiedAirtableWriteCapabilityEvidence(writebackEvidenceText) &&
    hasActiveSourceWriteback
  ) {
    fail(
      "Generated Airtable skills cannot mark source writeback ready without verified Airtable record-update evidence",
    );
  }
  validateBoundSourceOnboarding(sourceOnboardingText);
  if (
    hasDisallowedProviderEvidence(providerOnboardingText, {
      scanFreeFormEvidence: true,
    })
  ) {
    fail(
      "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools",
    );
  }
  validateBoundProviderOnboarding(providerOnboardingText, allowsBlockedOnboarding);
}

if (!/runtime gate/iu.test(skillText)) {
  fail("Generated skill SKILL.md must mention runtime gate requirements");
}

if (
  !skillText.includes("must not use a CLI bootstrap path") &&
  !skillText.includes("Do not use a CLI bootstrap path")
) {
  fail(
    "Generated skill SKILL.md must explicitly say it must not use a CLI bootstrap path",
  );
}

readText(safetyMd);
readText(examplesMd);

if (fs.existsSync(path.join(skillDir, "template.md"))) {
  fail("Generated outbound skills must not use template.md");
}

const textFiles = fs.existsSync(skillDir) ? walkTextFiles(skillDir) : [];
const allText = textFiles.map((filePath) => readText(filePath)).join("\n");

if (UNSUPPORTED_BINDING_LEVEL_RE.test(allText)) {
  fail(
    "Generated skill files must use fully-bound or parameterized-bound; unsupported binding levels are not allowed",
  );
}

if (UNSUPPORTED_EXECUTION_MODE_RE.test(allText)) {
  fail(
    "Generated skill files must use dry-run-then-batch-approval or approved-direct-execution; unsupported execution modes are not allowed",
  );
}

if (!allText.includes(REQUIRED_ROUTE)) {
  fail(`Generated skill must mention MCP provider route ${REQUIRED_ROUTE}`);
}

for (const filePath of textFiles) {
  const text = readText(filePath);
  if (NON_ENGLISH_SCRIPT_RE.test(text)) {
    fail(`Non-English CJK, Japanese, or Korean script found in generated skill file: ${filePath}`);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`Generated skill validation passed: ${skillDir}`);
