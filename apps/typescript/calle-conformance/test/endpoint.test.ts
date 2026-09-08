/**
 * CALLE_BASE_URL decides where the API key is sent, so it is a credential
 * destination and not a convenience setting. These tests exist because the
 * override used to be read straight out of the environment and handed to the
 * client, which meant anything able to set an environment variable could
 * redirect the key, and an http origin would have put it on the wire in clear.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
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
    const masked = maskPhone("+51917919061");
    assert.equal(masked, "+51*******61");
    assert.ok(!masked.includes("9179190"), "the subscriber number survived masking");
  });

  test("two different numbers still read as different", () => {
    assert.notEqual(maskPhone("+14155550100"), maskPhone("+14155550142"));
  });
});
