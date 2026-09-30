# Project TODO

- [x] Review strategy and build reports against the original Call Aunty references
- [x] Create Call Aunty brand icon assets and update app configuration
- [x] Apply Call Aunty theme tokens and mobile-first visual language
- [x] Implement role selection and language choice
- [x] Implement woman home with next action, voice handoff, and safety guidance
- [x] Implement resumable structured check-in flow
- [x] Implement care plan and referral detail flows
- [x] Implement CHW dashboard and prioritized work queue
- [x] Implement woman record and follow-up capture
- [x] Implement settings, privacy, safe-contact, and reminder preferences
- [x] Add local persistence for demo workflows and offline continuity
- [x] Add deterministic unit tests for triage states and follow-up transitions
- [x] Run TypeScript, lint, and test checks
- [x] Package the source project as a ZIP archive

- [x] Improve check-in recovery by restoring an unfinished local draft on relaunch
- [x] Add accessible labels, roles, and state announcements to critical actions
- [x] Extract reusable action-card and section-header components
- [x] Add a visible offline/sync status indicator for field workflows
- [x] Re-run TypeScript, lint, and tests and package the improved source

- [x] Add reusable action-card and sync-status UI components
- [x] Add a CHW woman-record detail route with structured next actions
- [x] Add a CHW follow-up form with offline draft save and completion state
- [x] Add tests for follow-up state transitions and draft validation
- [x] Re-run validation and package the latest source

- [x] Persist CHW follow-up drafts and restore them on relaunch
- [x] Persist completed follow-ups and reflect them in the queue state
- [x] Add a retry-safe local follow-up storage adapter
- [x] Add tests for draft restoration and completed queue state
- [x] Re-run validation and package the latest source

- [x] Add a sync queue record with stable IDs, attempts, and timestamps
- [x] Add a safe local data boundary with explicit serialization and queue status
- [x] Show queued follow-ups and retry state in the CHW dashboard
- [x] Add tests for queue deduplication and retry transitions
- [x] Re-run validation and package the latest source

- [x] Add a manual retry-sync action for queued follow-ups
- [x] Show queued, retrying, and synced states with counts in the CHW dashboard
- [x] Add a queue refresh action with safe error fallback
- [x] Add tests for manual retry transitions and queue state labels
- [x] Re-run validation and package the latest source

- [x] Persist and display a last-sync timestamp for the CHW queue
- [x] Show retry attempt counts and per-item queue state in the CHW dashboard
- [x] Add a graceful empty-queue state and clearer recovery copy
- [x] Add tests for last-sync formatting and queue display summaries
- [x] Re-run validation and package the latest source

- [x] Add a privacy-safe storage boundary for sync metadata and queue payloads
- [x] Add a local privacy lock state for sensitive CHW records
- [x] Prevent sync actions while the local privacy lock is active
- [x] Add tests for privacy-lock transitions and sync gating
- [x] Re-run validation and package the latest source

- [x] Add biometric-protected privacy unlock where supported
- [x] Handle unavailable or failed biometric unlock without exposing protected queue data
- [x] Add clearer locked-state copy and accessibility feedback
- [x] Add tests for unlock capability decisions and failure-safe behavior
- [x] Re-run validation and package the latest source

- [x] Add a configurable app-lock timeout after backgrounding
- [x] Require biometric unlock when protected CHW data is reopened after timeout
- [x] Add safe cancellation and failure feedback for resume unlock
- [x] Add tests for timeout and app-lock decision logic
- [x] Re-run validation and package the latest source

- [x] Add persisted privacy-lock timeout preference storage
- [x] Add Settings controls for 1, 5, and 15 minute lock intervals
- [x] Apply the selected timeout to background-resume locking
- [x] Add tests for timeout preference parsing and persistence boundaries
- [x] Re-run validation and package the latest source

- [x] Add an explicit timeout picker sheet to Settings
- [x] Add a secure passcode fallback for biometric-unavailable unlocks
- [x] Display the active timeout duration in the locked-state banner
- [x] Add tests for passcode validation and picker selection behavior
- [x] Re-run validation and package the latest source

- [x] Require passcode confirmation during first-time setup and changes
- [x] Add a safe passcode change flow with current-passcode verification
- [x] Add a reset flow that clears the local fallback safely
- [x] Improve unlock failure and recovery feedback
- [x] Add tests for confirmation, change, and reset boundaries
- [x] Re-run validation and package the latest source

- [x] Add passcode strength feedback during setup and confirmation
- [x] Add persisted failed-attempt counters with a short cooldown
- [x] Disable unlock submission during cooldown and explain the recovery path
- [x] Add tests for strength labels and cooldown boundaries
- [x] Re-run validation and package the latest source

- [x] Add a visible seconds-remaining cooldown countdown
- [x] Add safe recovery copy and a clear cancel path during cooldown
- [x] Prevent passcode input submission while cooldown is active
- [x] Add tests for countdown formatting and cooldown expiry
- [x] Re-run validation and package the latest source

- [x] Add a visual cooldown progress indicator
- [x] Re-enable passcode entry and retry automatically when cooldown expires
- [x] Add accessible cooldown state announcements
- [x] Add tests for cooldown progress and retry readiness
- [x] Re-run validation and package the latest source

- [x] Add Bangla privacy and cooldown recovery copy
- [x] Add a Settings security-status panel for lock, passcode, and biometric state
- [x] Show the active timeout and protected-storage status in one place
- [x] Add tests for localized security labels and status summaries
- [x] Re-run validation and package the latest source

- [x] Persist Bangla/English language preference locally
- [x] Make protected-flow cooldown and security summaries follow the selected language
- [x] Add a language toggle that updates the security panel immediately
- [x] Add tests for localized security summaries and digit formatting
- [x] Re-run validation and package the latest source

- [x] Consolidate protected-flow headings, timeout labels, and recovery messages into language resources
- [x] Apply localized copy to the timeout picker and passcode modal
- [x] Apply localized copy to lock-state and security-panel summaries
- [x] Add tests for complete protected-flow resource coverage
- [x] Re-run validation and package the latest source

- [x] Localize remaining Settings section headings and preference labels
- [x] Localize privacy promise and reset-passcode actions
- [x] Localize locked-state banner and protected action labels
- [x] Add tests for Settings and privacy resource coverage
- [x] Re-run validation and package the latest source

- [x] Add language-aware Home hero, check-in, care-plan, and voice-handoff copy
- [x] Add language-aware Care Plan screen headings, visit labels, and referral copy
- [x] Persist and consume the selected language consistently across tabs
- [x] Add tests for Home and Care Plan resource coverage
- [x] Re-run validation and package the latest source

- [x] Store sensitive sync queue payloads in SecureStore on native platforms with a web fallback
- [x] Add a bounded, payload-free security audit trail for lock and unlock outcomes
- [x] Re-run TypeScript, lint, and unit tests after storage hardening

- [ ] Connect the local sync queue to an authenticated idempotent server endpoint
- [ ] Validate SecureStore and biometric flows in native development builds
- [x] Package and deliver the latest source ZIP

- [x] Add an authenticated idempotent sync transport with safe offline fallback
- [x] Add native-safe security audit and queue storage coverage
- [x] Improve accessibility labels and localized status copy across active tabs
- [x] Validate native configuration and produce an updated source archive

- [x] Add connectivity-aware automatic retry for pending CHW sync items
- [x] Add a bounded retry policy with visible recovery state and last-attempt metadata
- [x] Add deterministic tests for automatic retry gating and failure fallback
- [x] Re-run validation and produce an updated source archive

- [x] Add structured sync attempt metadata and a privacy-safe observability summary
- [x] Add background-safe retry scheduling support with graceful native fallback
- [x] Add deterministic tests for sync observability and scheduling decisions
- [x] Re-run validation and produce an updated source archive

- [x] Add a localized Settings status row for background-sync registration and availability
- [x] Add native-safe diagnostics for biometric, SecureStore, and background-task capability states
- [x] Add deterministic tests for capability summary formatting and fallback behavior
- [x] Re-run validation and produce an updated source archive

- [x] Add a localized CHW sync diagnostic action with reachability and queue summary
- [x] Add accessible status announcements for diagnostic success and failure
- [x] Add deterministic tests for diagnostic summary formatting and fallback behavior
- [x] Re-run validation and produce an updated source archive

- [x] Add server-to-device reconciliation for synced follow-up records
- [x] Preserve local unsynced items when merging server responses
- [x] Add localized reconciliation status and accessible recovery feedback
- [x] Add deterministic tests for merge and conflict boundaries
- [x] Re-run validation and produce an updated source archive

- [x] Add visible localized reconciliation result state to the CHW dashboard
- [x] Persist reconciliation timestamp and outcome without storing health payloads in telemetry
- [x] Add accessible announcements for synced, preserved-local, and fallback outcomes
- [x] Add deterministic tests for reconciliation result summaries
- [x] Re-run validation and produce an updated source archive

- [x] Persist a metadata-only reconciliation history entry for the latest outcome
- [x] Show localized latest reconciliation time and outcome in the CHW queue
- [x] Add accessible labels for reconciliation history status and recovery actions
- [x] Add deterministic tests for bounded reconciliation history behavior
- [x] Re-run validation and produce an updated source archive

- [x] Add a compact expandable reconciliation history view for the latest metadata-only entries
- [x] Localize history sheet labels and accessible close/expand actions
- [x] Add deterministic tests for history ordering and display limits
- [x] Re-run validation and produce an updated source archive

- [x] Detect and classify multi-device reconciliation conflicts without exposing health payloads
- [x] Add localized conflict summary and safe resolution guidance
- [x] Add accessible conflict status and recovery actions
- [x] Add deterministic tests for conflict classification boundaries
- [x] Re-run validation and produce an updated source archive

- [x] Add explicit keep-local and accept-server conflict choices without exposing health payloads
- [x] Persist conflict decisions as metadata-only audit events
- [x] Add localized accessible confirmation and recovery copy
- [x] Add deterministic tests for conflict decision boundaries
- [x] Re-run validation and produce an updated source archive

- [x] Add a localized confirmation sheet before accepting server data
- [x] Keep cancellation safe and preserve local work until confirmation
- [x] Add accessible confirmation and cancel actions
- [x] Add deterministic tests for confirmation decision boundaries
- [x] Re-run validation and produce an updated source archive

- [x] Add a localized conflict-count summary to the accept-server confirmation sheet
- [x] Improve confirmation focus labels and screen-reader action descriptions
- [x] Add deterministic tests for conflict-summary formatting
- [x] Re-run validation and produce an updated source archive

- [x] Add metadata-only conflict decision entries to reconciliation history
- [x] Show the latest conflict decision in the history sheet with localized copy
- [x] Add accessible history labels for kept-local and accepted-server outcomes
- [x] Add deterministic tests for conflict-decision history formatting
- [x] Re-run validation and produce an updated source archive

- [x] Add localized filters for all, kept-local, and accepted-server reconciliation outcomes
- [x] Preserve safe empty states and accessible filter announcements
- [x] Add deterministic tests for history filtering and ordering
- [x] Re-run validation and produce an updated source archive

- [x] Add localized date context to reconciliation-history rows
- [x] Preserve accessible filter and close navigation in the history sheet
- [x] Add deterministic tests for localized date formatting and navigation labels
- [x] Re-run validation and produce an updated source archive

- [x] Add a localized latest-decision summary above reconciliation filters
- [x] Make the latest summary announce its outcome and timestamp accessibly
- [x] Add deterministic tests for latest-decision summary fallback behavior
- [x] Re-run validation and produce an updated source archive

- [x] Add a compact CHW dashboard card for the latest reconciliation decision
- [x] Localize dashboard-card title, empty state, and details action in Bangla and English
- [x] Add accessible card labeling and link it to the reconciliation history sheet
- [x] Re-run TypeScript, lint, tests, and visual preview verification
- [x] Produce the updated Call Aunty source archive

- [x] Localize remaining CHW queue headings, counts, sync actions, and follow-up labels
- [x] Add localized accessibility labels to retry, refresh, and queue status regions
- [x] Add deterministic localization tests for CHW counts and actions
- [x] Re-run TypeScript, lint, and tests successfully
- [x] Produce the updated Call Aunty source archive

- [x] Localize prioritized queue record metadata and open-count wording
- [x] Add accessible labels and hints to each CHW queue record action
- [x] Add deterministic tests for queue record copy coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add localized urgency labels and accessible urgency context to CHW queue records
- [x] Add localized next-action summaries for each prioritized queue record
- [x] Add deterministic tests for urgency and next-action copy coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Inspect current runtime logs and identify actionable errors or warnings
- [x] Add localized failure-safe handling for sync, privacy, and queue actions
- [x] Add deterministic tests for new error paths and fallbacks
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Inspect latest runtime logs and secure-storage persistence failure paths
- [x] Add safe native capability and secure-storage fallbacks with localized feedback
- [x] Add deterministic tests for secure-storage and capability error paths
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Inspect latest logs and remaining background-sync and metadata persistence failure paths
- [x] Add defensive background-sync and last-sync metadata fallbacks
- [x] Add deterministic tests for background-sync and metadata failure handling
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Inspect latest logs and audit remaining async UI and reconciliation history failures
- [x] Add guarded reconciliation-history and local-state recovery handling
- [x] Add deterministic tests for async failure fallbacks
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Expand the language registry beyond Bangla and English with safe fallback behavior
- [x] Add Hindi and Urdu translations for the core woman and CHW workflows
- [x] Replace the binary language toggle with an accessible multi-language picker
- [x] Add deterministic tests for language registry, persistence, and translation fallback
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add multilingual resources for CHW woman detail and follow-up flows
- [x] Localize CHW follow-up validation, save, and recovery feedback
- [x] Localize CHW detail actions and accessibility labels
- [x] Add deterministic tests for CHW route translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add multilingual Settings helper and recovery copy resources
- [x] Replace remaining hard-coded Settings alerts and labels with translations
- [x] Add language-aware RTL direction metadata for Urdu readiness
- [x] Add deterministic tests for Settings and recovery translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add safe device-locale detection with saved preference precedence
- [x] Localize remaining shared error, call-handoff, and privacy recovery messages
- [x] Add deterministic tests for locale mapping and shared-message translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Apply shared multilingual copy to remaining hard-coded woman and CHW alerts
- [x] Localize remaining plan detail and handoff message content
- [x] Add deterministic tests for shared-alert translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add localized spoken summaries and accessibility labels for care-plan cards
- [x] Localize remaining care-plan stage and referral metadata
- [x] Add deterministic tests for accessibility translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add localized woman-dashboard card accessibility summaries
- [x] Localize remaining woman-dashboard helper metadata and call-handoff labels
- [x] Add deterministic tests for woman-dashboard translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add localized CHW dashboard hero and queue accessibility summaries
- [x] Localize remaining CHW sync and privacy status accessibility hints
- [x] Add deterministic tests for CHW dashboard translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add localized live sync-result announcements for success, fallback, and preserved-local outcomes
- [x] Localize remaining CHW retry and recovery announcement hints
- [x] Add deterministic tests for sync-result translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add four-language background-sync registration and status copy
- [x] Localize native capability summaries and unavailable-state recovery hints
- [x] Add deterministic tests for background-sync translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add four-language security-settings status and helper copy
- [x] Localize background-task registration and completion status messages
- [x] Add deterministic tests for security and background-task translation coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add Tamil and Telugu to the language registry and Settings picker
- [x] Extend device-locale detection and direction metadata for Tamil and Telugu
- [x] Add Tamil and Telugu protected-flow, background-sync, and accessibility copy
- [x] Add deterministic tests for Tamil and Telugu resource coverage
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add a low-connectivity readiness summary for offline use and queued work
- [x] Improve local queue visibility with pending count, oldest item, and next retry context
- [x] Add privacy-safe offline recovery guidance and data-light sync controls
- [x] Add deterministic tests for offline readiness and queue summary behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add a persisted low-data mode preference
- [x] Add explicit sync-now and sync-over-Wi-Fi guidance without exposing health payloads
- [x] Add a lightweight offline education/content readiness model
- [x] Add deterministic tests for low-data policy and offline content behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add explicit connection-aware sync consent before manual transfer
- [x] Add resumable transfer metadata without storing extra health payloads
- [x] Add localized Wi-Fi/cellular transfer guidance and recovery feedback
- [x] Add deterministic tests for transfer policy and resumable metadata
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add visible transfer progress with privacy-safe item counts
- [x] Add pause, resume, and cancel controls for interrupted sync
- [x] Add low-bandwidth recovery guidance and localized transfer status copy
- [x] Add deterministic tests for transfer control state transitions
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add an offline care-plan snapshot with metadata-only freshness status
- [x] Add localized stale-data guidance and safe refresh recovery
- [x] Add deterministic tests for offline snapshot freshness and fallback behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add resumable offline check-in pack and local progress metadata
- [x] Add cached clinic/contact guidance with freshness status
- [x] Add privacy-locked clear-offline-data control
- [x] Add deterministic tests for offline check-in and data-management behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Connect offline check-in progress to a visible Home resume card
- [x] Add offline clinic/contact guidance access from the woman workflow
- [x] Add localized resume and guidance accessibility copy
- [x] Add deterministic tests for resume-card and guidance behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Add a dedicated offline check-in progress and recovery card
- [x] Add clear offline question progress and essential guidance access
- [x] Add localized accessibility copy for offline check-in states
- [x] Add deterministic tests for the dedicated offline check-in flow
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and harden the latest offline check-in and recovery flows
- [x] Improve accessibility and localized error feedback in the active mobile routes
- [x] Add deterministic regression tests for the new reliability improvements
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next native-safe offline interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next offline or native-safe mobile interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next offline or native-safe mobile interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next offline or native-safe mobile interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next offline or native-safe mobile interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next offline or native-safe mobile interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next offline or native-safe mobile interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next offline or native-safe mobile interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next offline or native-safe mobile interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive

- [x] Audit and improve the next offline or native-safe mobile interaction gap
- [x] Add localized accessibility and recovery feedback for the improvement
- [x] Add deterministic regression tests for the new mobile behavior
- [x] Re-run validation and produce the updated Call Aunty source archive
