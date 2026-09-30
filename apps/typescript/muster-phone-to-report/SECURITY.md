# Security and safe demo use

The default Simulator Lab is a credential-free, no-call replay. A successful
synthetic demonstration is not authorization or proof of safety for physical
monitoring equipment or production use.

## Keep secrets local

- Never commit provider API keys, auth tokens, real destination numbers, account
  identifiers, database passwords, signing keys, or private callback addresses.
- Use placeholder configuration and local secret-file references. An example
  file must never contain a copied live value.
- Do not force-add ignored runtime, evidence, environment, recording, or log files.
- Inspect the staged diff and all history being published, not only the current
  working tree. Ignore rules do not remove an existing committed secret.
- Scan every new release candidate with a secret scanner and check known runtime
  values privately. Review false positives narrowly; do not blanket-allow tests.
- If a real credential is exposed, revoke or rotate it with the provider before
  treating repository cleanup as sufficient.

## Live integrations

Live calls require explicit authorization for the specific owned synthetic
destination. The default budget is one outbound call with no automatic redial.
Twilio callbacks require signature and identity checks. Do not bypass preflight,
run gates, DTMF safeguards, or cleanup checks to obtain demo footage.

Persistent-webhook mode is opt-in and can accept inbound calls after an outbound
demo ends. Operators remain responsible for provider routing and possible costs.

## Reporting

Contact the repository maintainers privately for suspected credential exposure.
Do not post credentials, phone numbers, protected transcripts, or raw provider
payloads in a public issue. A screenshot can expose information even when source
files pass a secret scan.
