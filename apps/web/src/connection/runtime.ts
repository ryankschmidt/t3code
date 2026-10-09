import { Connection } from "@t3tools/client-runtime/connection";
import { ClientPresentation } from "@t3tools/client-runtime/platform";
import { clientHelloFromMetadata } from "@t3tools/client-runtime/rpc";
import { readWebReleaseIdentity } from "@t3tools/client-runtime/release-identity";
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

type ConnectionDiagnostic = Parameters<
  NonNullable<Parameters<typeof Connection.layerWithOptions>[0]["onDiagnostic"]>
>[0];
const connectionDiagnostics: ConnectionDiagnostic[] = [];

// Native probe owners can request these existing renderer facts without reading
// credentials, settings, raw RPC payloads, storage or a second connection.
export async function readThroughlineConnectionDiagnostic() {
  const [
    { appAtomRegistry },
    { primaryEnvironmentIdAtom },
    server,
    { environmentShell },
    { environmentCatalog },
    { AsyncResult },
    Option,
  ] = await Promise.all([
    import("../rpc/atomRegistry"),
    import("../state/primaryEnvironment"),
    import("../state/server"),
    import("../state/shell"),
    import("./catalog"),
    import("effect/unstable/reactivity"),
    import("effect/Option"),
  ]);
  const expectedEnvironmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
  const config = appAtomRegistry.get(server.primaryServerConfigAtom);
  const welcome = appAtomRegistry.get(server.primaryServerWelcomeAtom);
  const connection =
    expectedEnvironmentId === null
      ? null
      : Option.getOrNull(
          AsyncResult.value(
            appAtomRegistry.get(environmentCatalog.stateAtom(expectedEnvironmentId)),
          ),
        );
  return {
    expectedEnvironmentId,
    configEnvironmentId: config?.environment.environmentId ?? null,
    welcomeEnvironmentId: welcome?.environment.environmentId ?? null,
    welcomeReceived: welcome !== null,
    bootstrapStatus: welcome?.bootstrapStatus ?? null,
    shellStatus:
      config === null
        ? null
        : appAtomRegistry.get(environmentShell.stateValueAtom(config.environment.environmentId))
            .status,
    connectionPhase: connection?.phase ?? null,
    connectionStage: connection?.stage ?? null,
    connectionErrorReason: connection?.error?.reason ?? null,
    events: connectionDiagnostics.map((event) => ({ ...event })),
  };
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "__throughlineReadConnectionDiagnostic", {
    value: readThroughlineConnectionDiagnostic,
    configurable: true,
  });
}

const negotiatedConnectionLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { metadata } = yield* ClientPresentation;
    const identity = readWebReleaseIdentity({
      APP_VERSION: import.meta.env.APP_VERSION,
      APP_COMMIT: import.meta.env.APP_COMMIT,
    });
    const hello = clientHelloFromMetadata(
      {
        release: identity.release ?? undefined,
        platform: metadata.os ?? metadata.surface,
        commit: identity.fullCommit,
      },
      ["environmentThemes", "usageLimitSources", "usageLimitsCommand"],
    );
    if (hello === undefined)
      yield* Effect.logWarning(
        "Optional hello omitted: app release/platform metadata is unavailable.",
      );
    return Connection.layerWithOptions({
      onDiagnostic: (event) => {
        connectionDiagnostics.push({ ...event });
        if (connectionDiagnostics.length > 64) connectionDiagnostics.shift();
      },
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
