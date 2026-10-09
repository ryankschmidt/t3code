import { Connection } from "@t3tools/client-runtime/connection";
import { ClientPresentation } from "@t3tools/client-runtime/platform";
import { clientHelloFromMetadata } from "@t3tools/client-runtime/rpc";
import { readExpoReleaseIdentity } from "@t3tools/client-runtime/release-identity";
import { shellSnapshotLoaderLayer } from "@t3tools/client-runtime/state/shell";
import { threadSnapshotLoaderLayer } from "@t3tools/client-runtime/state/threads";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import Constants from "expo-constants";
import { Atom } from "effect/unstable/reactivity";

import type { FoundationHotModule } from "../lib/foundation-fast-refresh";
import { hotSwappableAtomRuntime } from "../lib/hot-swappable-atom-runtime";
import { runtimeContextLayer } from "../lib/runtime";
import { appAtomRegistry } from "../state/atom-registry";
import {
  mobileBackgroundActivityObserverLayer,
  mobileBackgroundActivityReporterLayer,
} from "./background-activity";
import { connectionPlatformLayer } from "./platform";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(
  Layer.provide(runtimeContextLayer),
);

const snapshotLoaderLayer = Layer.merge(threadSnapshotLoaderLayer, shellSnapshotLoaderLayer);

const negotiatedConnectionLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { metadata } = yield* ClientPresentation;
    const identity = readExpoReleaseIdentity(Constants.expoConfig);
    const hello = clientHelloFromMetadata(
      {
        release: identity.release ?? undefined,
        platform: metadata.os ?? metadata.surface,
        commit: identity.fullCommit,
      },
      ["usageLimitSources", "usageLimitsCommand"],
    );
    if (hello === undefined)
      yield* Effect.logWarning(
        "Optional hello omitted: installed app release/platform metadata is unavailable.",
      );
    return Connection.layerWithOptions({
      usageLimitSources: true,
      usageLimitsCommand: true,
      ...(hello === undefined ? {} : { hello }),
    });
  }),
);

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof snapshotLoaderLayer
  | typeof runtimeContextLayer
  | typeof connectionPlatformLayer
  | typeof mobileBackgroundActivityObserverLayer
  | typeof mobileBackgroundActivityReporterLayer;

const providedClientConnectionLayer = snapshotLoaderLayer.pipe(
  Layer.provideMerge(negotiatedConnectionLayer),
  Layer.provideMerge(
    Layer.mergeAll(
      runtimeContextLayer,
      providedConnectionPlatformLayer,
      mobileBackgroundActivityObserverLayer,
    ),
  ),
);

const connectionLayer = mobileBackgroundActivityReporterLayer.pipe(
  Layer.provideMerge(providedClientConnectionLayer),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = hotSwappableAtomRuntime({
  id: "t3.mobile.connection-runtime",
  hotModule: typeof module === "undefined" ? undefined : module.hot,
  registry: appAtomRegistry,
  layer: connectionLayer,
});
