import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  EnvironmentRegistry,
  EnvironmentSupervisor,
} from "@t3tools/client-runtime/connection";
import { createEnvironmentQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../../connection/runtime";
import { validateLauncherFamilyRead, type LauncherFamilyViewInput } from "./launcherFamily";

class LauncherFamilyReadMismatch extends Schema.TaggedError<LauncherFamilyReadMismatch>()(
  "LauncherFamilyReadMismatch",
  { expectedThreadId: Schema.String, receivedThreadId: Schema.String },
) {
  override get message() {
    return "Launcher read returned another public thread identity.";
  }
}

/** The method owner supplies the typed RPC effect; existing runtime binds the owning environment. */
export function createLauncherFamilyQuery<E>(
  read: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<LauncherFamilyViewInput, E, EnvironmentRegistry | EnvironmentSupervisor>,
) {
  return createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
    label: "throughline:launcher-family",
    execute: (input: { readonly threadId: ThreadId }) =>
      read(input).pipe(
        Effect.flatMap((family) =>
          Effect.try({
            try: () => validateLauncherFamilyRead(input, family),
            catch: () =>
              new LauncherFamilyReadMismatch({
                expectedThreadId: input.threadId,
                receivedThreadId: family.threadId,
              }),
          }),
        ),
      ),
  });
}
