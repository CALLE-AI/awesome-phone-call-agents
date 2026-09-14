# Provider descriptors

A descriptor is a JSON file describing one text-to-speech HTTP API. The app has no
vendor code, so a new provider is a descriptor rather than a change to `src/`.

A descriptor never holds a credential. It names the environment variable that
holds one. The loader enforces that in every field, because a descriptor is the
file people commit to a repository and paste to each other.

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | lowercase slug, used in output and in cache file names |
| `endpoint` | yes | full URL. `{voice}` and `{text}` are substituted, URL encoded |
| `method` | yes | `POST` or `GET` |
| `authHeader` | yes | header the credential travels in, for example `xi-api-key` |
| `authPrefix` | no | one auth scheme name such as `Bearer `, at most 16 characters plus a space |
| `authEnv` | yes | name of the environment variable holding the credential |
| `headers` | no | static headers such as a model name. Names and values are both checked |
| `bodyTemplate` | POST only | JSON body. `{text}` and `{voice}` are substituted and JSON escaped |
| `audio` | yes | where the audio bytes are in the response, see below |
| `format` | yes | `mp3`, `wav`, `ogg` or `pcm`. Names the cache file only |
| `maxChars` | yes | longest text the provider accepts in one request |
| `languages` | yes | BCP-47 tags this voice speaks, checked against the recipient locale |

An unknown field is refused rather than ignored. That closes the file to a key
pasted somewhere the app does not read. It also turns a misspelt real field into a
message instead of a silent default.

## No credential in any field

The credential comes from the environment variable named in `authEnv` and travels
in the header named in `authHeader`. It has no other home. The loader enforces
that rather than trusting it.

Where a field has a grammar, the grammar is the guard. `authEnv` has to look like
a variable name. `authPrefix` is one auth scheme name, at most 16 characters plus
an optional trailing space, which is what `Bearer ` and `AWS4-HMAC-SHA256 ` are.
`authHeader` and every static header name have to be HTTP header names. The
endpoint is parsed and a credential in front of the host is refused outright.

What is left is free text, so it is scanned for the shape of a key: 20 characters
with no separator or 24 counting `_` and `-`. The endpoint path, its query string
and its fragment are scanned separately so the refusal names the part. Static
header names and values, `bodyTemplate`, `audio.path` and `languages` are scanned
too. The host is not, because a long hostname of ordinary words is legitimate and
the allowlist already governs it. `name` and `authEnv` are not, because a
hyphenated product name and an underscored variable name both run past those
thresholds by design and neither string reaches a URL or a header.

The second threshold is 24 rather than 20 because
`examples/provider.elevenlabs.json` carries `eleven_multilingual_v2` in its body
template. That is 22 characters of exactly the alphabet a key is written in and it
is a model name. A false positive costs one rename. A false negative commits
somebody's key.

The check runs in `loadDescriptor` before any other validation and again in
`render`, because a descriptor built in code never passes the loader.

## Where the audio is

Three shapes, which cover every provider the examples were written against.

```jsonc
{ "kind": "body" }                                      // raw bytes in the response
{ "kind": "base64Field", "path": ["result", "audio"] }  // base64 inside JSON
{ "kind": "urlField",    "path": ["data", "url"] }      // a link that gets followed
```

`path` walks the decoded JSON key by key. A missing key, plus a value that is not a
non-empty string, is a refusal naming the path the descriptor declared.

`urlField` is the one shape where the provider decides what this app fetches next,
so the link is checked before it is followed: https, a host you named with
`--allow-host` or `VOICE_ALLOWED_HOSTS`, no credentials in the URL itself and no
literal address in loopback, link-local or private space. A provider whose audio
sits on a separate CDN host needs that host named too. The link is fetched without
the credential, because the key belongs to the endpoint.

Naming a host for audio does not authorize the credential there. The allowlist
answers what this app may fetch. Where the key may go is the endpoint origin and
nothing else, so an entry added so a CDN link can be followed cannot be turned
into a key drop by a `Location` header.

## Order of operations

Worth knowing, because it decides what has happened when a run fails.

1. The descriptor is checked against the credential contract above. A key in any
   field means nothing is sent and no credential is read.
2. The character limit is checked. Over the limit, nothing is sent and no
   credential is read.
3. The endpoint is checked against the allowlist. A host you did not name means
   nothing is sent and no credential is read. The endpoint is also the one origin
   the credential may reach.
4. The cache is checked. A hit returns without a request.
5. The credential is read from the environment. Missing means nothing is sent.
6. The request goes out. A non-2xx status, plus a response with no audio at the
   declared location, is a refusal and no file is written.
7. A redirect is followed by hand, up to three hops. On the request carrying the
   credential a hop has to be on the endpoint origin, so a provider can move one
   of its own paths and nothing else. A hop off that origin is refused rather than
   retried without the key, because continuing would send the script body to a host
   the provider chose.
8. An audio URL in the response carries no credential, so it gets the allowlist
   check instead. So does every hop it takes.

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
