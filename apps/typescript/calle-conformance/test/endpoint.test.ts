/**
 * CALLE_BASE_URL decides where the API key is sent, so it is a credential
 * destination and not a convenience setting. These tests exist because the
 * override used to be read straight out of the environment and handed to the
 * client, which meant anything able to set an environment variable could
 * redirect the key, and an http origin would have put it on the wire in clear.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { baseUrl, maskPhone, PUBLIC_TESTING_HOTLINE } from "../src/endpoint.ts";

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const before = process.env.CALLE_BASE_URL;
  if (value === undefined) delete process.env.CALLE_BASE_URL;
  else process.env.CALLE_BASE_URL = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.CALLE_BASE_URL;
    else process.env.CALLE_BASE_URL = before;
  }
}

describe("the API key can only be sent to CALL-E, over https", () => {
  test("unset falls back to production", () => {
    assert.equal(withEnv(undefined, baseUrl), "https://api.heycall-e.com");
  });

  test("the documented test host is allowed, trailing slash and all", () => {
    assert.equal(withEnv("https://test-api.heycall-e.com/", baseUrl), "https://test-api.heycall-e.com");
  });

  test("http is refused, whatever the host", () => {
    assert.throws(() => withEnv("http://api.heycall-e.com", baseUrl), /must be https/);
  });

  test("another origin is refused even over https", () => {
    assert.throws(() => withEnv("https://attacker.example.com", baseUrl), /only point at a CALL-E origin/);
  });

  test("a path on an allowed origin cannot smuggle a different destination", () => {
    assert.equal(withEnv("https://api.heycall-e.com/../evil", baseUrl), "https://api.heycall-e.com");
  });

  test("something that is not a URL is refused rather than ignored", () => {
    assert.throws(() => withEnv("not a url", baseUrl), /is not a URL/);
  });
});

describe("a destination printed to a terminal is not a dialable number", () => {
  test("the published hotline stays legible, because it is public", () => {
    assert.match(maskPhone(PUBLIC_TESTING_HOTLINE), /\+12763229632/);
  });

  test("any other number loses everything but its country code and last two digits", () => {
    // +44 7700 900xxx is Ofcom's drama range, reserved so it can never be dialled.
    const masked = maskPhone("+447700900142");
    assert.equal(masked, "+447*******42");
    assert.ok(!masked.includes("7009001"), "the subscriber number survived masking");
  });

  test("two different numbers still read as different", () => {
    assert.notEqual(maskPhone("+14155550100"), maskPhone("+14155550142"));
  });
});

/**
 * Masking a destination is only worth anything if every probe actually uses it.
 * One of them printed the raw number for weeks, in a project whose own argument
 * is that terminal output ends up pasted into issues. A reviewer found it, which
 * is the wrong way round, so the rule is enforced here instead of remembered.
 */
describe("no probe prints a destination or a transcript by default", () => {
  const scripts = readdirSync("scripts")
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [f, readFileSync(join("scripts", f), "utf8")] as const);

  test("there are probes to check", () => {
    assert.ok(scripts.length > 0, "no scripts found to check");
  });

  for (const [name, source] of scripts) {
    test(`${name} masks the destination it prints`, () => {
      const printsRaw = /process\.stdout\.write\([^\n]*\$\{\s*phone\s*\}/.test(source);
      assert.equal(printsRaw, false, `${name} prints the destination without maskPhone`);
    });

    test(`${name} does not print transcript text unasked`, () => {
      // turn.text reaching stdout is only allowed behind an explicit opt-in.
      const printsText = /process\.stdout\.write\([^\n]*\bturn\.text\b/.test(source);
      if (!printsText) return;
      assert.ok(
        source.includes("--print-transcript"),
        `${name} prints transcript text with no --print-transcript gate`,
      );
    });
  }
});
