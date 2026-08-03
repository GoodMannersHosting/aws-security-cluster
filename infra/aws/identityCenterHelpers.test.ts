import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  awsScimUserMappingExpression,
  resolveAssignmentsPending,
} from "./identityCenterHelpers";

describe("awsScimUserMappingExpression", () => {
  it("maps userName to email and clears photos", () => {
    const expr = awsScimUserMappingExpression();
    assert.match(expr, /userName.*request\.user\.email/s);
    assert.match(expr, /photos.*None/s);
  });
});

describe("resolveAssignmentsPending", () => {
  it("is pending when either group id is missing", () => {
    assert.equal(resolveAssignmentsPending(undefined, "g2"), true);
    assert.equal(resolveAssignmentsPending("g1", undefined), true);
  });
  it("is not pending when both ids exist", () => {
    assert.equal(resolveAssignmentsPending("g1", "g2"), false);
  });
});
