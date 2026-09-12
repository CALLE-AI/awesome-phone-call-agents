# Mobile release

## Status

| Step | State |
| --- | --- |
| Android JS bundle | **Verified** — 2.59 MB Hermes bytecode |
| iOS JS bundle | **Verified** — 2.60 MB Hermes bytecode |
| TypeScript | **Verified** — clean |
| Signed `.aab` / `.ipa` | **BLOCKED** — needs developer credentials |
| Store submission | **BLOCKED** — needs developer accounts |

Both platforms bundle real Hermes bytecode. This is a React Native app with
native navigation, native pickers and native permission prompts — not a website
in a WebView.

What is missing is purely credentials, not code: a Google Play service account
and an Apple Developer account with a distribution certificate and provisioning
profile. Nothing about the app has to change to produce store artefacts.

## Verify the bundle yourself

```bash
cd apps/mobile
npm install
npx tsc --noEmit
npx expo export --platform android --output-dir dist-check
npx expo export --platform ios     --output-dir dist-check-ios
```

## Running against a real backend

The mobile app talks to the API directly (there is no BFF proxy on native), so
it needs a reachable address. `localhost` is the *device's* localhost, not your
machine's.

```bash
# apps/mobile/.env  — or export it
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000   # your machine's LAN IP
```

Then:

```bash
npm run dev:mobile      # Expo dev server
```

`EXPO_PUBLIC_API_URL` is public by design — it is an address, not a secret. No
API key of any kind is ever shipped in the bundle.

## Producing release builds

### Prerequisites

- **Android**: a Google Play developer account, an upload keystore, and a
  service-account JSON if you want automated submission.
- **iOS**: an Apple Developer account, a distribution certificate and an App
  Store provisioning profile. A Mac with Xcode is required for a local build;
  EAS Build produces one without a Mac.

### With EAS (recommended)

```bash
npm install -g eas-cli
eas login
eas build:configure

eas build --platform android --profile production   # -> .aab
eas build --platform ios     --profile production   # -> .ipa
```

`eas build:configure` writes `eas.json`. Set the API URL per profile so the
production build points at production:

```json
{
  "build": {
    "production": {
      "env": { "EXPO_PUBLIC_API_URL": "https://api.example.com" }
    }
  }
}
```

### Locally, without EAS

```bash
npx expo prebuild --clean        # generates native android/ and ios/ projects
cd android && ./gradlew bundleRelease
# iOS: open ios/Dial.xcworkspace in Xcode, Product > Archive
```

`android/` and `ios/` are gitignored — they are generated from `app.json`, which
is the source of truth for bundle identifiers, permissions and plugins.

## Permissions

Requested at the point of use, never at launch, and the app works without them.

| Permission | When | If denied |
| --- | --- | --- |
| Location (when in use) | Tapping "Use my location" | The user types a place instead; Dial asks if it needs one |
| Notifications | On first completed task | Results still appear in the app |
| Microphone | Only if voice input is used | Typing works exactly as before |

Purpose strings are in `app.json` and are written for a human, not for the
reviewer:

> "Dial uses your location to find businesses near you to call. It is only read
> when you start a task."

## Store submission checklist

- [ ] Bundle identifiers set (`com.dial.app` on both — change to your own).
- [ ] Version and build number incremented.
- [ ] `EXPO_PUBLIC_API_URL` points at production.
- [ ] Icon and splash assets supplied (`app.json` currently sets colours only).
- [ ] Privacy policy URL published — see `docs/PRIVACY.md`, which **requires
      legal review first**.
- [ ] Apple privacy nutrition labels: declare location (used, not linked to
      identity, not for tracking), contact info (email), and user content
      (task text).
- [ ] Google Play data safety form: same disclosures.
- [ ] Explain the AI calling behaviour in the store listing. Both stores ask
      about automated calling; Dial identifies itself as an AI on every call and
      does not do bulk or unsolicited calling, which is the relevant answer.

## Deep links

Scheme `dial://`. `dial://task/<id>` opens a task directly, which is what a
completion notification uses.
