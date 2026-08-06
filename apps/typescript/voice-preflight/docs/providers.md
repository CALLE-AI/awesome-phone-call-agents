# Provider descriptors

A descriptor is a JSON file describing one text-to-speech HTTP API. The app has no
vendor code, so a new provider is a descriptor rather than a change to `src/`.

A descriptor never holds a credential. It names the environment variable that
holds one. The loader enforces that, because a descriptor is the file people
commit to a repository and paste to each other.

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | lowercase slug, used in output and in cache file names |
| `endpoint` | yes | full URL. `{voice}` and `{text}` are substituted, URL encoded |
| `method` | yes | `POST` or `GET` |
| `authHeader` | yes | header the credential travels in, for example `xi-api-key` |
| `authPrefix` | no | prefix such as `Bearer `, kept separate so the variable holds only the key |
| `authEnv` | yes | name of the environment variable holding the credential |
| `headers` | no | static headers such as a model name. A long opaque value here is refused |
| `bodyTemplate` | POST only | JSON body. `{text}` and `{voice}` are substituted and JSON escaped |
| `audio` | yes | where the audio bytes are in the response, see below |
| `format` | yes | `mp3`, `wav`, `ogg` or `pcm`. Names the cache file only |
| `maxChars` | yes | longest text the provider accepts in one request |
| `languages` | yes | BCP-47 tags this voice speaks, checked against the recipient locale |

## Where the audio is

Three shapes, which cover every provider the examples were written against.

```jsonc
{ "kind": "body" }                                      // raw bytes in the response
{ "kind": "base64Field", "path": ["result", "audio"] }  // base64 inside JSON
{ "kind": "urlField",    "path": ["data", "url"] }      // a link that gets followed
```

`path` walks the decoded JSON key by key. A missing key, plus a value that is not a
non-empty string, is a refusal naming the path the descriptor declared.

## Order of operations

Worth knowing, because it decides what has happened when a run fails.

1. The character limit is checked. Over the limit, nothing is sent and no
   credential is read.
2. The endpoint is checked against the allowlist. A host you did not name means
   nothing is sent and no credential is read.
3. The cache is checked. A hit returns without a request.
4. The credential is read from the environment. Missing means nothing is sent.
5. The request goes out. A non-2xx status, plus a response with no audio at the
   declared location, is a refusal and no file is written.

## The shipped examples

`examples/provider.elevenlabs.json` is built from the published
`POST /v1/text-to-speech/{voice_id}` reference: `xi-api-key`, a JSON body whose
only required field is `text`, plus raw audio in the response body. The `maxChars`
value is this app's own conservative ceiling rather than a documented provider
limit, because that page does not state one.

`examples/provider.fish-audio.json` is built from a working implementation:
`POST https://api.fish.audio/v1/tts`, `authorization: Bearer`, a static `model`
header, a body carrying `text` and `reference_id`, plus raw audio in the body.

`examples/provider.local-fake.json` matches `fake/tts-server.ts`. Its endpoint
carries port 0 as a placeholder because the fake binds a random port, so the demo
and the tests build that descriptor in code.

Check any descriptor against the provider's current reference before you rely on
it. An API changes and a descriptor is a copy of what it looked like on the day it
was written.
