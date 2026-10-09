import { Connection } from "@t3tools/client-runtime/connection";
import { ClientPresentation } from "@t3tools/client-runtime/platform";
import { clientHelloFromMetadata } from "@t3tools/client-runtime/rpc";
import { shellSnapshotLoaderLayer } from "@t3tools/client-runtime/state/shell";
import { threadSnapshotLoaderLayer } from "@t3tools/client-runtime/state/threads";
import { pullRequestDiffLoaderLayer } from "@t3tools/client-runtime/state/pull-requests";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import { runtimeContextLayer } from "../lib/runtime";
import {
  backgroundActivityObserverLayer,
  backgroundActivityReporterLayer,
} from "../lib/backgroundActivityReporter";
import { connectionPlatformLayer } from "./platform";

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(
  Layer.provide(runtimeContextLayer),
);

const snapshotLoaderLayer = Layer.mergeAll(
  threadSnapshotLoaderLayer,
  shellSnapshotLoaderLayer,
  pullRequestDiffLoaderLayer,
);

const negotiatedConnectionLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { metadata } = yield* ClientPresentation;
    const hello = clientHelloFromMetadata(
      {
        // Unlike branding.APP_VERSION, this is the injected value without a fallback.
        release: import.meta.env.APP_VERSION,
        platform: metadata.os ?? metadata.surface,
        commit: null,
      },
      ["environmentThemes", "usageLimitSources", "usageLimitsCommand"],
    );
    if (hello === undefined)
      yield* Effect.logWarning(
        "Optional hello omitted: app release/platform metadata is unavailable.",
      );
    return Connection.layerWithOptions({
      environmentThemes: true,
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
  | typeof backgroundActivityObserverLayer
  | typeof backgroundActivityReporterLayer;

const providedClientConnectionLayer = snapshotLoaderLayer.pipe(
  Layer.provideMerge(negotiatedConnectionLayer),
  Layer.provideMerge(
    Layer.mergeAll(
      runtimeContextLayer,
      providedConnectionPlatformLayer,
      backgroundActivityObserverLayer,
    ),
  ),
);

const connectionLayer = backgroundActivityReporterLayer.pipe(
  Layer.provideMerge(providedClientConnectionLayer),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = Atom.runtime(connectionLayer);
