/**
 * Where the CALL-E key is allowed to go. Run from the plugin directory:
 *
 *   node --test examples/workflow-safety.test.mjs
 *
 * `apiBaseUrl` is on the config screen because an operator may run against their own
 * tenant, and it was interpolated straight into the request URL on the same lines that
 * build the Authorization header from CALL_E_API_KEY. Any value that reached that field
 * received a live credential: an http:// paste, a typo, a host that merely ends with the
 * approved name, or an edited export.
 *
 * Redirects are the second route out. n8n's httpRequest follows them by default and the
 * axios client underneath replays request headers when it does, so a single 302 hands the
 * Authorization header to whatever the Location names.
 *
 * These tests read the generated workflow rather than the generator, because the JSON is
 * the artifact people import.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(
  await readFile(join(HERE, "absence-wave.workflow.json"), "utf8"),
);
const byName = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));

// Both nodes that touch the API, named once so a rename fails here rather than silently
// stopping these checks from covering anything.
const GUARDED = ["Validate Config", "Create Call And Wait"];

/** The gate, lifted out of the generated node so it is the shipped copy under test. */
function gateFrom(nodeName) {
  const code = byName[nodeName].parameters.jsCode;
  const end = code.indexOf("const APPROVED_API_HOSTS");
  assert.ok(end !== -1, `${nodeName} carries no host allowlist`);
  const tail = code.indexOf("const NO_CREDENTIAL_REDIRECTS");
  const gate = code.slice(end, code.indexOf("\n", code.indexOf("}", tail)) + 1);
  return new Function(gate + "\nreturn approvedApiBaseUrl;")();
}

test("both nodes that reach the API carry the gate", () => {
  for (const name of GUARDED) {
    assert.ok(byName[name], `the workflow has no node called ${name}`);
    assert.match(byName[name].parameters.jsCode, /approvedApiBaseUrl/,
      `${name} sends a request without resolving apiBaseUrl first`);
  }
});

test("neither request follows a redirect", () => {
  const code = byName["Create Call And Wait"].parameters.jsCode;
  const requests = code.split("this.helpers.httpRequest").length - 1;
  assert.equal(requests, 2, "the node makes the create and the poll request");
  const refusals = code.split("...NO_CREDENTIAL_REDIRECTS").length - 1;
  assert.equal(refusals, requests,
    "a request that follows a redirect replays the Authorization header to the new host");
  assert.match(code, /disableFollowRedirect: true/);
  assert.match(code, /maxRedirects: 0/);
});

test("the shipped default is the approved host over https", () => {
  const config = byName["Absence Config"].parameters.jsCode;
  assert.match(config, /apiBaseUrl: "https:\/\/api\.heycall-e\.com"/);
});

test("an approved https host resolves to its origin", () => {
  const approved = gateFrom("Validate Config");
  for (const written of ["https://api.heycall-e.com", "https://api.heycall-e.com/",
                         "  https://api.heycall-e.com  "]) {
    assert.equal(approved(written).url, "https://api.heycall-e.com",
      `${written} did not resolve to the approved origin`);
  }
});

test("everything else is refused, and the refusal says why", () => {
  const approved = gateFrom("Validate Config");
  const refused = {
    "http://api.heycall-e.com": /https/,
    // Ends with the approved name and is a different host. A suffix test passes this.
    "https://api.heycall-e.com.example.net": /not approved/,
    "https://evil.example": /not approved/,
    "https://user:pw@api.heycall-e.com": /credentials in the URL/,
    "https://api.heycall-e.com/v1": /path/,
    "https://api.heycall-e.com?x=1": /query or a fragment/,
    "https://api.heycall-e.com#f": /query or a fragment/,
    "not a url": /not a URL/,
    "": /empty/,
  };
  for (const [written, why] of Object.entries(refused)) {
    const result = approved(written);
    assert.equal(result.url, undefined,
      `${JSON.stringify(written)} was accepted and would receive a CALL-E key`);
    assert.match(result.error, why);
  }
});

test("the call node refuses before it builds the Authorization header", () => {
  const code = byName["Create Call And Wait"].parameters.jsCode;
  const gate = code.indexOf("approvedApiBaseUrl(row.apiBaseUrl)");
  const header = code.indexOf("Bearer ");
  assert.ok(gate !== -1 && header !== -1);
  assert.ok(gate < header,
    "the key is assembled before the destination is known good");
});
