import assert from "node:assert/strict";
import test from "node:test";
import { actorFromClaims, hasPermission } from "../authorization.js";

test("requires a non-empty OIDC subject", () => {
  assert.equal(actorFromClaims({}, "https://issuer.example"), null);
  assert.equal(actorFromClaims({ sub: "" }, "https://issuer.example"), null);
});

test("extracts explicit permissions from scopes and roles", () => {
  const actor = actorFromClaims({ sub: "operator-1", scope: "openid medroute.read", scp: "medroute.live", roles: ["auditor"] }, "https://issuer.example");
  assert.equal(hasPermission(actor, "medroute.read"), true);
  assert.equal(hasPermission(actor, "medroute.live"), true);
  assert.equal(hasPermission(actor, "auditor"), true);
  assert.equal(hasPermission(actor, "medroute.admin"), false);
});

test("pseudonymous owners are stable per issuer and subject", () => {
  const first = actorFromClaims({ sub: "operator-1" }, "https://issuer.example");
  const same = actorFromClaims({ sub: "operator-1" }, "https://issuer.example");
  const other = actorFromClaims({ sub: "operator-2" }, "https://issuer.example");
  assert.equal(first.subject, same.subject);
  assert.notEqual(first.subject, other.subject);
  assert.notEqual(first.subject, "operator-1");
});
