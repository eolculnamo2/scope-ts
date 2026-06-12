type CleanupFn = () => unknown | Promise<unknown>;
type OnCloseFn<Name extends string> = (name: Name) => unknown | Promise<unknown>;
export type T<Name extends string> = {
  name: Name;
  isClosed: () => boolean;
  isClosing: () => boolean;
  isOpen: () => boolean;
  close: () => Promise<void>;
  add: (fn: CleanupFn) => void;
  child: <N extends string>(scope: T<N>) => T<N>;
};

export type Options<Name extends string> = {
  onClose?: OnCloseFn<Name>;
  // closes signals associated with controller
  abortController?: AbortController;
};

export const create = <const Name extends string>(name: Name, options?: Options<Name>): T<Name> => {
  const registry: Array<CleanupFn> = [];
  const children: Map<string, T<string>> = new Map();
  const onCloseFns: OnCloseFn<Name>[] = [];
  if (options?.onClose) {
    onCloseFns.push(options.onClose);
  }
  let closeState: "open" | "closing" | "closed" = "open";
  return {
    isClosed: () => closeState === "closed",
    isClosing: () => closeState === "closing",
    isOpen: () => closeState === "open",
    name,
    async close() {
      if (closeState !== "open") {
        return;
      }
      closeState = "closing";
      console.debug(`${name} scope cleaning`);
      options?.abortController?.abort();
      while (onCloseFns.length > 0) {
        const onClose = onCloseFns.pop();
        if (!onClose) continue;

        try {
          await onClose(name);
        } catch (e) {
          console.error(`onClose function registered in Scope-TS failed to cleanup`, e);
        }
      }
      while (registry.length > 0) {
        const cleanup = registry.pop();
        if (!cleanup) continue;
        try {
          await cleanup();
        } catch (e) {
          console.error(`some clean up functions registered in Scope-TS failed to cleanup`);
        }
      }
      closeState = "closed";
    },
    add: (fn) => {
      if (closeState !== "open") {
        // can possibly make this inferred later via type system
        throw new Error("cannot add cleanup functions to closed scope");
      }
      registry.push(fn);
    },
    child: (scope) => {
      if (closeState !== "open") {
        // can possibly make this inferred later via type system
        throw new Error("cannot add child scope to closed parent scope");
      }
      if (children.has(scope.name)) {
        throw new Error(`${scope.name} is already registered to scope`);
      }
      children.set(scope.name, scope);
      onCloseFns.push(async () => {
        await children.get(scope.name)?.close();
        children.delete(scope.name);
      });
      return scope;
    },
  };
};
