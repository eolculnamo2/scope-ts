import { expect, test } from "bun:test";
import { Scope } from "./main.js";

test("the package entry point exports the Scope namespace", async () => {
  const scope = Scope.create("main");

  expect(scope.name).toBe("main");
  await scope.close();
  expect(scope.isClosed()).toBeTrue();
});
