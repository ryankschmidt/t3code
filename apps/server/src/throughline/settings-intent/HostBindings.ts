import type {
  SettingsIntentEvent,
  SettingsRollbackResult,
  SettingsHost,
} from "./SettingsIntent.ts";
import { createSettingsIntent } from "./SettingsIntent.ts";
import { createCurrentSettingsAdapter } from "./CurrentSettingsAdapter.ts";

export interface PublicHostMap {
  readonly source: string;
  readonly revision: string;
  readonly hosts: readonly { readonly role: SettingsHost; readonly environmentId: string }[];
}
export interface AuthenticatedContinuationPort {
  readonly environmentId: string;
  readonly verifyAuthenticated: () => Promise<{
    readonly environmentId: string;
    readonly authenticated: boolean;
  }>;
  readonly readContinuation: () => Promise<boolean>;
  readonly patchContinuation: (value: boolean) => Promise<boolean>;
}
export interface ExistingRecordContext {
  readonly owner: "OrchestrationEngine";
  readonly environmentId: string;
  readonly threadId: string;
}
export interface DurableSettingsReceipt {
  readonly environmentId: string;
  readonly commandId: string;
  readonly sequence: number;
  readonly threadId: string;
}
export type SettingsBindingRecord =
  | {
      readonly operation: "apply";
      readonly bindings: PublicHostMap;
      readonly event: SettingsIntentEvent;
    }
  | {
      readonly operation: "rollback";
      readonly bindings: PublicHostMap;
      readonly event: SettingsIntentEvent;
      readonly hosts: readonly SettingsRollbackResult[];
    };
export interface ExistingSettingsConsumer {
  readonly context: ExistingRecordContext;
  readonly verifyExistingContext: (context: ExistingRecordContext) => Promise<boolean>;
  readonly append: (
    record: SettingsBindingRecord,
    context: ExistingRecordContext,
  ) => Promise<DurableSettingsReceipt>;
}
export interface HostBindingOptions {
  readonly publicHostMap?: PublicHostMap | null;
  readonly verifyPublicHostMap?: (map: PublicHostMap) => Promise<boolean>;
  readonly ports?: readonly AuthenticatedContinuationPort[];
  readonly consumer?: ExistingSettingsConsumer | null;
}
export interface BoundSettingsResult {
  readonly event: SettingsIntentEvent;
  readonly bindings: PublicHostMap;
  readonly receipt: DurableSettingsReceipt;
  readonly effectiveMatch: boolean;
}

const ROLES: readonly SettingsHost[] = ["mac", "twr", "rpi"];
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value === value.trim();

function snapshotMap(input: PublicHostMap | null | undefined): PublicHostMap {
  if (!input) throw new Error("PUBLIC_HOST_MAP_MISSING");
  if (
    !nonempty(input.source) ||
    !nonempty(input.revision) ||
    !Array.isArray(input.hosts) ||
    input.hosts.length !== ROLES.length ||
    input.hosts.some(
      (host) => !host || !ROLES.includes(host.role) || !nonempty(host.environmentId),
    ) ||
    new Set(input.hosts.map((host) => host.role)).size !== ROLES.length ||
    new Set(input.hosts.map((host) => host.environmentId)).size !== ROLES.length
  ) {
    throw new Error("PUBLIC_HOST_MAP_INVALID");
  }
  return Object.freeze({
    source: input.source,
    revision: input.revision,
    hosts: Object.freeze(
      ROLES.map((role) => {
        const host = input.hosts.find((candidate) => candidate.role === role)!;
        return Object.freeze({ role, environmentId: host.environmentId });
      }),
    ),
  });
}

/** Append outcome can be unknown even after host writes. Keep only field-limited
 * evidence for the owning caller to reconcile; never leak a transport cause,
 * automatically retry an uncertain append, or assert that it did not persist. */
export class UnconfirmedSettingsRecordError extends Error {
  readonly record: SettingsBindingRecord;

  constructor(record: SettingsBindingRecord) {
    super("DURABLE_RECEIPT_UNCONFIRMED");
    this.record = record;
  }
}

export function createHostBindings(options: HostBindingOptions) {
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const result = pending.then(run);
    pending = result.catch(() => undefined);
    return result;
  };

  const prepare = async () => {
    const map = snapshotMap(options.publicHostMap);
    const consumer = options.consumer;
    if (
      !consumer ||
      typeof consumer.verifyExistingContext !== "function" ||
      typeof consumer.append !== "function"
    ) {
      throw new Error("DURABLE_CONSUMER_UNBOUND");
    }
    if (
      !nonempty(consumer.context?.environmentId) ||
      !map.hosts.some((host) => host.environmentId === consumer.context.environmentId)
    ) {
      throw new Error("DURABLE_CONTEXT_INVALID");
    }
    if (consumer.context?.owner !== "OrchestrationEngine" || !nonempty(consumer.context.threadId)) {
      throw new Error("DURABLE_CONTEXT_INVALID");
    }
    const context = Object.freeze({
      owner: consumer.context.owner,
      environmentId: consumer.context.environmentId,
      threadId: consumer.context.threadId,
    });
    const ports = options.ports;
    if (
      !ports ||
      ports.length !== ROLES.length ||
      map.hosts.some(
        (host) => ports.filter((port) => port.environmentId === host.environmentId).length !== 1,
      ) ||
      ports.some(
        (port) =>
          typeof port.verifyAuthenticated !== "function" ||
          typeof port.readContinuation !== "function" ||
          typeof port.patchContinuation !== "function",
      )
    ) {
      throw new Error("HOST_PORT_UNBOUND");
    }
    let admitted = false;
    try {
      admitted = (await options.verifyPublicHostMap?.(map)) === true;
    } catch {
      /* Do not retain external errors. */
    }
    if (!admitted) throw new Error("PUBLIC_HOST_MAP_NOT_ADMITTED");
    let existing = false;
    try {
      existing = (await consumer.verifyExistingContext(context)) === true;
    } catch {
      /* Refuse before writes. */
    }
    if (!existing) throw new Error("DURABLE_CONTEXT_UNAVAILABLE");
    const adapters = [];
    for (const host of map.hosts) {
      const port = ports.find((candidate) => candidate.environmentId === host.environmentId)!;
      let authenticated = false;
      try {
        const identity = await port.verifyAuthenticated();
        authenticated =
          identity?.authenticated === true && identity.environmentId === host.environmentId;
      } catch {
        /* No credential material or causes cross this boundary. */
      }
      if (!authenticated) throw new Error("HOST_AUTHENTICATION_UNVERIFIED");
      adapters.push(
        createCurrentSettingsAdapter(host.role, {
          readContinuation: () => port.readContinuation(),
          patchContinuation: async (patch) => {
            const effective = await port.patchContinuation(patch.continueThreadsAfterServerUpdate);
            if (typeof effective !== "boolean") throw new Error("FIELD_PROJECTION_INVALID");
          },
        }),
      );
    }
    return { map, context, consumer, core: createSettingsIntent(adapters) };
  };

  const append = async (
    record: SettingsBindingRecord,
    prepared: Awaited<ReturnType<typeof prepare>>,
  ) => {
    try {
      const receipt = await prepared.consumer.append(record, prepared.context);
      if (
        !receipt ||
        receipt.threadId !== prepared.context.threadId ||
        receipt.environmentId !== prepared.context.environmentId ||
        !nonempty(receipt.commandId) ||
        !Number.isSafeInteger(receipt.sequence) ||
        receipt.sequence < 1
      ) {
        throw new Error("invalid receipt");
      }
      return Object.freeze({
        threadId: receipt.threadId,
        environmentId: receipt.environmentId,
        commandId: receipt.commandId,
        sequence: receipt.sequence,
      });
    } catch {
      throw new UnconfirmedSettingsRecordError(record);
    }
  };

  return {
    applyIntent: async (setting: string, value: unknown): Promise<BoundSettingsResult> => {
      if (setting !== "continueThreadsAfterServerUpdate") throw new Error("SETTING_EXCLUDED");
      if (typeof value !== "boolean") throw new Error("SETTING_VALUE_INVALID");
      return serialize(async () => {
        const prepared = await prepare();
        const event = await prepared.core.applyIntent(setting, value);
        const receipt = await append(
          { operation: "apply", bindings: prepared.map, event },
          prepared,
        );
        const effectiveMatch =
          event.hosts.length === ROLES.length &&
          event.hosts.every(
            (host) =>
              host.effective === value &&
              (host.status === "applied" || host.status === "unchanged"),
          );
        return Object.freeze({ event, bindings: prepared.map, receipt, effectiveMatch });
      });
    },
    rollbackIntent: async (
      result: BoundSettingsResult,
    ): Promise<{
      readonly hosts: readonly SettingsRollbackResult[];
      readonly receipt: DurableSettingsReceipt;
    }> =>
      serialize(async () => {
        const prepared = await prepare();
        const original = snapshotMap(result.bindings);
        if (result.receipt.environmentId !== prepared.context.environmentId) {
          throw new Error("HOST_BINDING_CHANGED");
        }
        if (
          original.source !== prepared.map.source ||
          original.revision !== prepared.map.revision ||
          original.hosts.some(
            (host, index) => host.environmentId !== prepared.map.hosts[index]!.environmentId,
          ) ||
          result.receipt.threadId !== prepared.context.threadId
        ) {
          throw new Error("HOST_BINDING_CHANGED");
        }
        const hosts = await prepared.core.rollbackIntent(result.event);
        const receipt = await append(
          { operation: "rollback", bindings: prepared.map, event: result.event, hosts },
          prepared,
        );
        return { hosts, receipt };
      }),
  };
}
