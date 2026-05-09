import { EnvironmentId, type VcsListRefsResult } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createVcsRefManager,
  EMPTY_VCS_REF_STATE,
  vcsRefStateAtom,
  type VcsRefClient,
} from "./vcsRefState.ts";

let atomRegistry = AtomRegistry.make();

function resetAtomRegistry() {
  atomRegistry.dispose();
  atomRegistry = AtomRegistry.make();
}

const noop = () => undefined;

const TARGET = { environmentId: EnvironmentId.make("env-local"), cwd: "/repo" } as const;

const FIRST_PAGE: VcsListRefsResult = {
  refs: [
    { name: "main", current: true, isDefault: true, worktreePath: null },
    { name: "feature/a", current: false, isDefault: false, worktreePath: null },
  ],
  isRepo: true,
  hasPrimaryRemote: true,
  nextCursor: 2,
  totalCount: 3,
};

const SECOND_PAGE: VcsListRefsResult = {
  refs: [{ name: "feature/b", current: false, isDefault: false, worktreePath: null }],
  isRepo: true,
  hasPrimaryRemote: true,
  nextCursor: null,
  totalCount: 3,
};

function createMockClient() {
  const listRefs = vi.fn(async (input: Parameters<VcsRefClient["listRefs"]>[0]) => {
    if (input.query === "feature") {
      return {
        ...FIRST_PAGE,
        refs: FIRST_PAGE.refs.filter((branch) => branch.name.includes("feature")),
        nextCursor: null,
        totalCount: 2,
      } satisfies VcsListRefsResult;
    }

    if (input.cursor === 2) {
      return SECOND_PAGE;
    }

    return FIRST_PAGE;
  });

  return {
    client: { listRefs } satisfies VcsRefClient,
    listRefs,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createVcsRefManager", () => {
  afterEach(() => {
    resetAtomRegistry();
  });

  it("loads the first page and stores it in atom state", async () => {
    const mock = createMockClient();
    const manager = createVcsRefManager({
      getRegistry: () => atomRegistry,
      getClient: () => mock.client,
    });

    const promise = manager.load(TARGET, mock.client, { limit: 100 });

    expect(manager.getSnapshot(TARGET)).toEqual({
      data: null,
      isPending: true,
      error: null,
    });

    await expect(promise).resolves.toEqual(FIRST_PAGE);
    expect(manager.getSnapshot(TARGET)).toEqual({
      data: FIRST_PAGE,
      isPending: false,
      error: null,
    });
    expect(mock.listRefs).toHaveBeenCalledWith({ cwd: "/repo", limit: 100 });
  });

  it("loads the next page and appends branches", async () => {
    const mock = createMockClient();
    const manager = createVcsRefManager({
      getRegistry: () => atomRegistry,
      getClient: () => mock.client,
    });

    await manager.load(TARGET, mock.client);
    const next = await manager.loadNext(TARGET, mock.client);

    expect(next).toEqual({
      ...SECOND_PAGE,
      refs: [...FIRST_PAGE.refs, ...SECOND_PAGE.refs],
    });
    expect(manager.getSnapshot(TARGET)).toEqual({
      data: {
        ...SECOND_PAGE,
        refs: [...FIRST_PAGE.refs, ...SECOND_PAGE.refs],
      },
      isPending: false,
      error: null,
    });
  });

  it("stores query-specific state independently", async () => {
    const mock = createMockClient();
    const manager = createVcsRefManager({
      getRegistry: () => atomRegistry,
      getClient: () => mock.client,
    });

    const queriedTarget = { ...TARGET, query: "feature" } as const;
    const queried = await manager.load(queriedTarget, mock.client);

    expect(queried?.refs.map((branch) => branch.name)).toEqual(["feature/a"]);
    expect(manager.getSnapshot(TARGET).data).toBeNull();
    expect(manager.getSnapshot(queriedTarget).data?.refs.map((branch) => branch.name)).toEqual([
      "feature/a",
    ]);
  });

  it("returns cached data when no client is available", async () => {
    const manager = createVcsRefManager({
      getRegistry: () => atomRegistry,
      getClient: () => null,
    });

    atomRegistry.set(vcsRefStateAtom("env-local:/repo:"), {
      data: FIRST_PAGE,
      isPending: false,
      error: null,
    });

    await expect(manager.load(TARGET)).resolves.toEqual(FIRST_PAGE);
  });

  it("resets state", async () => {
    const mock = createMockClient();
    const manager = createVcsRefManager({
      getRegistry: () => atomRegistry,
      getClient: () => mock.client,
    });

    await manager.load(TARGET, mock.client);
    manager.reset();

    expect(manager.getSnapshot(TARGET)).toEqual(EMPTY_VCS_REF_STATE);
  });

  it("watches branches with a ref-counted client-change subscription", async () => {
    const mock = createMockClient();
    let listener: () => void = noop;
    const unsubscribe = vi.fn();
    const manager = createVcsRefManager({
      getRegistry: () => atomRegistry,
      getClient: () => mock.client,
      subscribeClientChanges: (nextListener) => {
        listener = nextListener;
        return unsubscribe;
      },
      watchLimit: 100,
    });

    const firstUnwatch = manager.watch(TARGET);
    const secondUnwatch = manager.watch(TARGET);
    await Promise.resolve();

    expect(mock.listRefs).toHaveBeenCalledTimes(1);
    expect(mock.listRefs).toHaveBeenCalledWith({ cwd: "/repo", limit: 100 });

    listener();
    await Promise.resolve();
    expect(mock.listRefs).toHaveBeenCalledTimes(1);

    firstUnwatch();
    expect(unsubscribe).not.toHaveBeenCalled();
    secondUnwatch();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("swallows watched refresh failures after storing error state", async () => {
    const refreshError = new Error("backend unavailable");
    const listRefs = vi.fn(async () => {
      throw refreshError;
    });
    const onBackgroundError = vi.fn();
    const manager = createVcsRefManager({
      getRegistry: () => atomRegistry,
      getClient: () => ({ listRefs }),
      onBackgroundError,
    });

    manager.watch(TARGET);
    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(manager.getSnapshot(TARGET)).toEqual({
        data: null,
        isPending: false,
        error: "backend unavailable",
      });
      expect(onBackgroundError).toHaveBeenCalledWith(refreshError);
    });
  });

  it("starts a new watched refresh when the client is replaced while a load is in flight", async () => {
    const firstLoad = deferred<VcsListRefsResult>();
    const secondLoad = deferred<VcsListRefsResult>();
    const firstListRefs = vi.fn(() => firstLoad.promise);
    const secondListRefs = vi.fn(() => secondLoad.promise);
    const firstClient = { listRefs: firstListRefs } satisfies VcsRefClient;
    const secondClient = { listRefs: secondListRefs } satisfies VcsRefClient;
    let currentClient: VcsRefClient = firstClient;
    let listener: () => void = noop;
    const manager = createVcsRefManager({
      getRegistry: () => atomRegistry,
      getClient: () => currentClient,
      subscribeClientChanges: (nextListener) => {
        listener = nextListener;
        return noop;
      },
    });

    manager.watch(TARGET);
    await Promise.resolve();
    expect(firstListRefs).toHaveBeenCalledTimes(1);

    currentClient = secondClient;
    listener();
    await Promise.resolve();
    expect(secondListRefs).toHaveBeenCalledTimes(1);

    secondLoad.resolve(SECOND_PAGE);
    await secondLoad.promise;
    expect(manager.getSnapshot(TARGET).data).toEqual(SECOND_PAGE);

    firstLoad.resolve(FIRST_PAGE);
    await firstLoad.promise;
    expect(manager.getSnapshot(TARGET).data).toEqual(SECOND_PAGE);
  });
});
