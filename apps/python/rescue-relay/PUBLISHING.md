# Publish Rescue Relay 5.6.0

## What is prepared

The kit contains the application source, a current v5.6 product-demonstration video, a historical long-form tutorial, a chapter player, current screenshots, and submission text. The public demonstration uses fictional test contacts and scenarios to protect privacy. Live CALL-E transport is implemented in the same source.

## Confirm the external requirements

Checked 10 September 2026. The Devpost rules list a deadline of **14 September 2026, 11:45 pm SGT**. They require a functioning CALL-E project, a pull request to the designated public repository, the PR URL on Devpost, an English description, a publicly visible YouTube/Vimeo demo link and the CALL-E account email. The main video should be **under three minutes**; an app URL is optional. Recheck the rules before submitting.

Rules: https://call-e.devpost.com/rules
Contribution guide: https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/CONTRIBUTING.md
App catalog: https://github.com/CALLE-AI/awesome-phone-call-agents/tree/main/apps

## 1. Check one clean installation and the CALL-E path

Run the source from a fresh virtual environment, not from a folder containing an old `.env`. Complete the fictional example. Run the verification commands in README.md.

For private provider verification, complete the consented local check in `submission/LIVE_VERIFICATION.md` and retain the genuine provider call ID and outcome outside the public repository. Do not publish private transcripts or describe a fictional rescue as a real-world outcome.

## 2. Upload the correct video

The short product demonstration is public at https://www.youtube.com/watch?v=GcaoplYcIh0. Use this as the primary Devpost video, not the longer tutorial. The tutorial can be a second help link.

Suggested title: **Rescue Relay — CALL-E Product Demonstration**.

Suggested description: “A product demonstration of Rescue Relay v5.6 showing the complete working workflow: clarify a rescue goal, contact approved responders, compare availability and prices, approve the selected plan, and track confirmed progress to a safe outcome. Fictional test contacts and scenarios protect privacy. The submitted application supports live CALL-E calls through the documented Calls API.”

The public watch page reports the expected title and 2:55 duration. Confirm that all text is readable in full screen and the beginning/end were not trimmed by the upload service. The release includes no copyrighted music or third-party competitor branding.

## 3. Open the repository PR

This is a runnable Python application, so use **apps/python/rescue-relay/** rather than plugins or skills. Fork the designated repository, create a branch, and copy the app source there. Do not copy `.env`, private evidence, databases, caches, old release archives or dependency folders. Copy the `rescue-relay-app/` folder from the complete kit, renaming it `rescue-relay` at the destination. The app folder includes the player and both media files, so the walkthrough works after copying.

```bash
# In your fork of awesome-phone-call-agents:
git checkout -b feat/rescue-relay
mkdir -p apps/python/rescue-relay
# Copy the contents of rescue-relay-app into the folder above.
# Add the catalog entry using submission/CATALOG_ENTRY.md.
python3 scripts/validate_repository.py
git status --short
# Review the diff and secret scan before adding files.
git add apps/python/rescue-relay apps/README.md
git commit -m "feat(apps): add Rescue Relay"
git push -u origin feat/rescue-relay
```

Use `submission/PR_DESCRIPTION.md` for the PR body. The repository validator itself must run in the actual fork; it was not run against a made-up local repository in this release. Open the PR against `CALLE-AI/awesome-phone-call-agents`, not the integration SDK repository. Copy the resulting real PR URL.

The complete app folder includes the MP4s so its walkthrough works immediately. If maintainers prefer release-hosted media, move the MP4s to public release assets and update the player source URLs together; do not leave a broken player. Keep the public short-video link in the PR/testing instructions after upload.

No licence file was in the supplied archive. Confirm ownership and choose appropriate licensing before public distribution; no author identity or licence grant has been invented for you.

## 4. Complete Devpost

Use `submission/DEVPOST.md` for the project title, tagline and story. Add the actual PR URL, publicly visible short-video URL and email associated with your CALL-E account. Add a hosted fictional demo URL only after verifying it. Use the real app screenshots in `submission/gallery/`.

Proofread the live-verification status, team details and any optional-model description. Do not paste placeholders as actual links. Keep the build available for judging under the published rules.

## Optional public demo hosting

The mock-only public product test is deployed on Render Free at https://rescue-relay.onrender.com. HTTP Basic protects every route except `/health`, which reports v5.6.0. Reviewer credentials are stored only in Render and Devpost’s private testing instructions. No CALL-E or LLM credential is configured.

**Do not deploy a live-key-enabled server publicly.** This app has no account system, workspace isolation or public-abuse controls. A public demo is a shared fictional sandbox; visitors can edit the same contacts and reports. It is not a private incident-reporting service.

Use a separate installation with a disposable database and exactly these settings:

```dotenv
CALL_MODE=mock
ENABLE_LIVE_CALLS=false
CALLE_API_KEY=
LLM_ALLOWED_ORIGINS=
LLM_BASE_URL=
LLM_MODEL=
LLM_API_KEY=
LLM_FALLBACK=true
APP_ENV=production
BASIC_AUTH_USERNAME=<private reviewer username>
BASIC_AUTH_PASSWORD=<private generated password>
HOST=0.0.0.0
PORT=8000
DATABASE_PATH=/data/demo.db
```

Use one worker, a writable volume for `/data`, TLS and platform-level access/abuse controls. Never copy the local live database, `.env` or private evidence to the demo instance. `APP_ENV=production` disables the in-app example-reset endpoint; the example loader still works. Reset a public fictional database only during a deliberate maintenance restart. Prefer the downloadable local build when per-reviewer sandboxing cannot be provided.

A container definition is supplied; it now includes all Python modules needed at runtime:

```bash
docker build -t rescue-relay:5.6.0 .
docker run --rm -p 127.0.0.1:8000:8000 \
  -e APP_ENV=production -e CALL_MODE=mock -e ENABLE_LIVE_CALLS=false \
  -e BASIC_AUTH_USERNAME=reviewer -e BASIC_AUTH_PASSWORD='<generated-secret>' \
  -e CALLE_API_KEY= -e LLM_ALLOWED_ORIGINS= -e LLM_BASE_URL= -e LLM_MODEL= -e LLM_API_KEY= \
  -v rescue-relay-demo:/data rescue-relay:5.6.0
```

The container build and hosting were not executed in the restricted release environment. The local Python application and packaging module closure were checked. Do not describe deployment as verified until your chosen platform passes startup, `/health`, static-media serving and the full browser journey.
