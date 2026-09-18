# Safety and Compliance

## Core Safety Principles

### 1. Transparent and Bounded Adaptation
The skill must never make speech adjustments that could be perceived as manipulative or deceptive:
- **Maximum single-window adjustment**: No single TTS directive may shift pitch by more than 3 semitones, rate by more than 20%, or energy by more than 30%.
- **Host timing**: The helper uses a 0.05 interpolation factor with separate parameter caps. It does not enforce a five-second window or 5% output limit; a host must choose and evaluate an application cadence.
- **Audit logging**: No logger is included. A future host may log suitably minimized adjustment metadata; this prototype makes no standards-compliance claim.

### 2. No Emotional Manipulation
This skill is designed to increase **rapport and comfort**, not to exploit psychological vulnerabilities:
- The system must never be used to mirror a distressed caller's agitation with the intent of amplifying negative emotions.
- In `SUPPORT` mode (mental health or crisis lines), convergence is strictly downward (toward calm, slow speech) regardless of caller's baseline.

### 3. Caller Consent
- In regulated contexts (e.g., healthcare or financial services), callers must be informed during the call opening that the agent's voice may adapt to better serve them.
- The disclosure can be as simple as: *"Our AI assistant is designed to communicate in a way that is most comfortable for you."*

### 4. Bias Validation
- Entrainment baselines must be validated across diverse speaker demographics. Speakers with non-standard prosodic profiles (e.g., non-native English speakers, speakers with speech impediments) must not be penalized by the system.
- Threshold calibration must explicitly include such populations in the validation dataset.

### 5. Testing Protocol
All demonstration data and unit tests strictly use the `555-01xx` numbering block (e.g., `555-0122`, `555-0188`) to prevent accidental targeting of real individuals during development and validation (compliance per PR #288).
