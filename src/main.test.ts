import { expect, test } from "bun:test";
import { Outcome, Scope } from "./main.js";

test("the package entry point exports the public namespaces", async () => {
  const scope = Scope.create("main");
  const outcome = Outcome.success(scope);

  expect(outcome.success).toBeTrue();
  if (!outcome.success) {
    throw new Error("expected successful outcome");
  }

  expect(outcome.value).toBe(scope);
  await scope.close();
  expect(scope.isClosed()).toBeTrue();
});
