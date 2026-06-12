import { expect, mock, test } from "bun:test";
import { Scope } from ".";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

test("create returns an open root scope with an empty registry", () => {
  const scope = Scope.create("main");
  expect(scope.name).toBe("main");
  expect(scope.isClosed()).toBeFalse();
});

test("should close sync function", async () => {
  const scope = Scope.create("main");
  const cleanup = mock(() => null);
  scope.add(() => {
    cleanup();
  });
  expect(scope.isClosed()).toBeFalse();
  await scope.close();
  expect(scope.isClosed()).toBeTrue();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test("should close async function", async () => {
  const scope = Scope.create("main");
  const cleanup = mock(async () => new Promise((res) => setTimeout(() => res(null), 10)));
  scope.add(() => cleanup());
  expect(scope.isClosed()).toBeFalse();
  await scope.close();
  expect(scope.isClosed()).toBeTrue();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test("should close mix of async and sync functions", async () => {
  const scope = Scope.create("main");
  const cleanup = mock(async () => new Promise((res) => setTimeout(() => res(null), 10)));
  const cleanup1 = mock(() => null);
  const cleanup2 = mock(() => null);
  const cleanup3 = mock(async () => new Promise((res) => setTimeout(() => res(null), 10)));

  scope.add(cleanup);
  scope.add(cleanup1);
  scope.add(cleanup2);
  scope.add(cleanup3);

  expect(scope.isClosed()).toBeFalse();
  await scope.close();
  expect(scope.isClosed()).toBeTrue();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test("should close children", async () => {
  const scope = Scope.create("main");
  const cleanup = mock(async () => new Promise((res) => setTimeout(() => res(null), 10)));
  const cleanup1 = mock(() => null);
  const cleanup2 = mock(() => null);
  const cleanup3 = mock(async () => new Promise((res) => setTimeout(() => res(null), 10)));
  const cleanup4 = mock(async () => new Promise((res) => setTimeout(() => res(null), 10)));

  const child = scope.child(Scope.create("ch1"));
  if (!child.success) throw new Error("failed to create child");
  const child1 = child.value.child(Scope.create("ch2"));
  if (!child1.success) throw new Error("failed to create child");
  const child2 = child1.value.child(Scope.create("ch3"));
  if (!child2.success) throw new Error("failed to create child");
  const child3 = child2.value.child(Scope.create("ch4"));
  if (!child3.success) throw new Error("failed to create child");

  scope.add(cleanup);
  child.value.add(cleanup1);
  child1.value.add(cleanup2);
  child2.value.add(cleanup3);
  child3.value.add(cleanup4);

  expect(scope.isClosed()).toBeFalse();
  await scope.close();
  expect(scope.isClosed()).toBeTrue();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(cleanup1).toHaveBeenCalledTimes(1);
  expect(cleanup2).toHaveBeenCalledTimes(1);
  expect(cleanup3).toHaveBeenCalledTimes(1);
  expect(cleanup4).toHaveBeenCalledTimes(1);
});

test("should cancel signals on abortController", async () => {
  const controller = new AbortController();
  const p = new Promise((res, rej) => {
    const timeout = setTimeout(() => res(null), 2000);
    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        rej();
      },
      { once: true },
    );
  });
  const scope = Scope.create("main", {
    abortController: controller,
  });
  let rejected = false;
  await scope.close();
  try {
    await p;
  } catch {
    rejected = true;
  }
  expect(rejected).toBeTrue();
});

test.todo("concurrent and repeated close calls share one completion promise", async () => {
  const releaseCleanup = deferred();
  const cleanup = mock(async () => {
    await releaseCleanup.promise;
  });
  const onClose = mock(() => {});
  const scope = Scope.create("main", { onClose });
  scope.add(cleanup);

  const first = scope.close();
  const second = scope.close();
  const concurrentCallsSharePromise = first === second;

  releaseCleanup.resolve();
  await Promise.all([first, second]);

  const repeated = scope.close();
  const repeatedCallSharesPromise = repeated === first;
  await repeated;

  expect(concurrentCallsSharePromise).toBeTrue();
  expect(repeatedCallSharesPromise).toBeTrue();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a synchronous cleanup failure does not prevent exhaustive cleanup or finalization", async () => {
  const calls: string[] = [];
  const child = Scope.create("child", {
    onClose: () => calls.push("child:onClose"),
  });
  child.add(() => calls.push("child:cleanup"));

  const scope = Scope.create("main", {
    onClose: () => calls.push("main:onClose"),
  });
  scope.child(child);
  scope.add(() => calls.push("first"));
  scope.add(() => {
    calls.push("bad");
    throw new Error("cleanup failed");
  });
  scope.add(() => calls.push("last"));

  await expect(scope.close()).resolves.toBeUndefined();

  expect(calls).toContain("first");
  expect(calls).toContain("bad");
  expect(calls).toContain("last");
  expect(calls).toContain("child:cleanup");
  expect(calls).toContain("child:onClose");
  expect(calls).toContain("main:onClose");
  expect(scope.isClosed()).toBeTrue();
  expect(child.isClosed()).toBeTrue();
});

test("an asynchronous cleanup failure does not prevent exhaustive cleanup or finalization", async () => {
  const calls: string[] = [];
  const scope = Scope.create("main", {
    onClose: () => calls.push("onClose"),
  });
  scope.add(() => calls.push("good"));
  scope.add(async () => {
    calls.push("bad");
    throw new Error("cleanup failed");
  });

  await expect(scope.close()).resolves.toBeUndefined();

  expect(calls).toContain("good");
  expect(calls).toContain("bad");
  expect(calls).toContain("onClose");
  expect(scope.isClosed()).toBeTrue();
});

test("resources and children cannot be registered once closure starts", async () => {
  const releaseCleanup = deferred();
  const scope = Scope.create("main");
  scope.add(async () => {
    await releaseCleanup.promise;
  });

  const closing = scope.close();
  const closingWhenClosureStarted = scope.isClosing();
  let addDuringCloseError: unknown;
  let childDuringCloseError: unknown;

  try {
    scope.add(() => {});
  } catch (error) {
    addDuringCloseError = error;
  }
  try {
    scope.child(Scope.create("during-close"));
  } catch (error) {
    childDuringCloseError = error;
  }

  releaseCleanup.resolve();
  await closing;

  expect(closingWhenClosureStarted).toBeTrue();
  expect(addDuringCloseError).toBeInstanceOf(Error);
  expect(childDuringCloseError).toBeInstanceOf(Error);
  expect(() => scope.add(() => {})).toThrow();
  expect(() => scope.child(Scope.create("after-close"))).toThrow();
});

test("children cannot be registered after closure finishes", async () => {
  const scope = Scope.create("main");

  await scope.close();

  expect(() => scope.child(Scope.create("late"))).toThrow(
    "cannot add child scope to closed parent scope",
  );
});

test("cleanup functions complete sequentially in LIFO order", async () => {
  const releaseLast = deferred();
  const calls: string[] = [];
  const scope = Scope.create("main");
  scope.add(() => calls.push("first"));
  scope.add(() => calls.push("second"));
  scope.add(async () => {
    calls.push("last:start");
    await releaseLast.promise;
    calls.push("last:end");
  });

  const closing = scope.close();
  await Promise.resolve();
  const callsBeforeLastFinished = [...calls];

  releaseLast.resolve();
  await closing;

  expect(callsBeforeLastFinished).toEqual(["last:start"]);
  expect(calls).toEqual(["last:start", "last:end", "second", "first"]);
});

test("close functions complete sequentially in LIFO order", async () => {
  const releaseLastChild = deferred();
  const calls: string[] = [];
  const scope = Scope.create("main", {
    onClose: () => calls.push("main"),
  });
  scope.child(
    Scope.create("first", {
      onClose: () => calls.push("first"),
    }),
  );
  scope.child(
    Scope.create("second", {
      onClose: () => calls.push("second"),
    }),
  );
  scope.child(
    Scope.create("last", {
      onClose: async () => {
        calls.push("last:start");
        await releaseLastChild.promise;
        calls.push("last:end");
      },
    }),
  );

  const closing = scope.close();
  await Promise.resolve();
  await Promise.resolve();
  const callsBeforeLastChildFinished = [...calls];

  releaseLastChild.resolve();
  await closing;

  expect(callsBeforeLastChildFinished).toEqual(["last:start"]);
  expect(calls).toEqual(["last:start", "last:end", "second", "first", "main"]);
});

test("duplicate child names return a failed outcome without replacing the first child", async () => {
  const calls: string[] = [];
  const scope = Scope.create("main");
  const first = Scope.create("child", {
    onClose: () => calls.push("first"),
  });
  const duplicate = Scope.create("child", {
    onClose: () => calls.push("duplicate"),
  });

  expect(scope.child(first).success).toBeTrue();
  const result = scope.child(duplicate);
  expect(result.success).toBeFalse();

  await scope.close();
  expect(calls).toEqual(["first"]);
});
