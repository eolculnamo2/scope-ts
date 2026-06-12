# scope-ts

Small, hierarchical resource cleanup for TypeScript.

`scope-ts` groups synchronous and asynchronous cleanup functions into named
scopes. Scopes can own child scopes, allowing an entire dependency tree to be
closed with one call.

## Installation

```bash
npm install scope-ts
```

```bash
bun add scope-ts
```

## Basic Usage

Register cleanup functions with `scope.add()`, then await `scope.close()` when
the resources are no longer needed.

```ts
import { Scope } from "scope-ts";

const app = Scope.create("app");
const connection = await openDatabaseConnection();

app.add(async () => {
  await connection.close();
});

try {
  await runApplication(connection);
} finally {
  await app.close();
}
```

Cleanup functions run sequentially in last-in, first-out (LIFO) order.

```ts
const scope = Scope.create("request");

scope.add(() => console.log("close database"));
scope.add(() => console.log("flush response"));

await scope.close();

// flush response
// close database
```

## Child Scopes

Use `scope.child()` to attach an existing scope. It returns an `Outcome`
indicating whether the child was added. Child names must be unique within their
parent.

```ts
import { Scope } from "scope-ts";

const app = Scope.create("app");
const database = Scope.create("database");

const result = app.child(database);

if (!result.success) {
  throw new Error(result.reason);
}

database.add(async () => {
  await connection.close();
});

await app.close();
```

Children close sequentially in reverse registration order before the parent's
cleanup functions run. Each child recursively closes its own children and
cleanup functions.

## Close Hooks And Cancellation

Pass `onClose` to run a callback after a scope's children close and before its
cleanup functions run. The callback receives the scope name.

An optional `AbortController` is aborted as soon as closing begins, allowing
active work to observe cancellation before cleanup starts.

```ts
const controller = new AbortController();

const request = Scope.create("request", {
  abortController: controller,
  onClose: (name) => {
    console.log(`${name} children closed`);
  },
});

request.add(async () => {
  await flushPendingWork();
});

await fetch(url, { signal: controller.signal });
await request.close();
```

Cleanup and close-hook failures are logged, and closing continues through the
remaining callbacks.

## Scope State

```ts
const scope = Scope.create("worker");

scope.isOpen(); // true

const closing = scope.close();
scope.isClosing(); // true while asynchronous cleanup is running

await closing;
scope.isClosed(); // true
```

Cleanup functions and child scopes cannot be added after closing begins.

## API

### `Scope`

| API                                      | Description                                                        |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `Scope.create(name, options?)`           | Create a named scope                                               |
| `options.onClose`                        | Callback run after children close and before local cleanup         |
| `options.abortController`                | Controller aborted when closing begins                             |
| `scope.name`                             | The scope's name                                                   |
| `scope.add(cleanup)`                     | Register a sync or async cleanup function                          |
| `scope.child(childScope)`                | Attach a uniquely named child and return an `Outcome`              |
| `scope.close()`                          | Close children, run the close hook, then run cleanup functions     |
| `scope.isOpen()`                         | Whether the scope accepts new cleanup functions and children       |
| `scope.isClosing()`                      | Whether closing is currently in progress                           |
| `scope.isClosed()`                       | Whether closing has completed                                     |

### `Outcome`

`Outcome.success(value)` and `Outcome.fail(reason)` create discriminated
results using the `success` property.

```ts
import { Outcome } from "scope-ts";

const result = Outcome.success("ready");

if (result.success) {
  console.log(result.value);
} else {
  console.error(result.reason);
}
```

## Development

```bash
bun install
bun test
bun run check
bun run build
```
