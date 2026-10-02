import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter } from "effect/unstable/http";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { EnvironmentAuth, ServerAuthMissingCredentialError } from "../../auth/EnvironmentAuth.ts";
import {
  OPERATOR_PROFILE_ROUTE,
  OPERATOR_PROFILE_SUMMARY_ROUTE,
  operatorProfileRouteLayer,
} from "./http.ts";
import { OperatorProfile, type OperatorProfileReport } from "./OperatorProfile.ts";

const report: OperatorProfileReport = {
  schema: "throughline.operator-profile-receipt.v1",
  written_at: "2026-09-28T12:00:00.000Z",
  app_version: "0.0.51",
  profile_version: "1.0.0",
  host: { platform: "linux", home: "/home/twr" },
  ok: false,
  counts: { applied: 1, overridden_locally: 0, rejected: 1, not_for_this_host: 0 },
  overrides_file: { path: "/srv/state/operator-profile-overrides.json", state: "absent" },
  effective: { continueThreadsAfterServerUpdate: true, "providerInstances.pi": {} },
  rows: [
    {
      entry: "continueThreadsAfterServerUpdate",
      key: "continueThreadsAfterServerUpdate",
      outcome: "applied",
      code: "APPLIED_OVER_DEFAULT",
      detail: "set over the upstream default",
      reason: "resume after restarts",
      effective: true,
    },
    {
      entry: "providerInstances.pi",
      key: "providerInstances",
      outcome: "rejected",
      code: "LAUNCHER_MISSING",
      detail: "launcher not found at /home/twr/.local/bin/ryan-pi",
      reason: "governed launcher",
      effective: {},
    },
  ],
  not_owned: [],
};

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

const fixture = (session: ReadonlyArray<AuthEnvironmentScope> | "none", mounted = true) => {
  const auth = Layer.succeed(EnvironmentAuth, {
    authenticateHttpRequest: () =>
      session === "none"
        ? Effect.fail(new ServerAuthMissingCredentialError({}))
        : Effect.succeed({
            sessionId: AuthSessionId.make("test"),
            subject: "test",
            method: "bearer-access-token",
            scopes: session,
          }),
  } as unknown as EnvironmentAuth["Service"]);
  const profile = Layer.succeed(OperatorProfile, {
    apply: (settings) => Effect.succeed(settings),
    latest: Effect.succeed(Option.some(report)),
  } as OperatorProfile["Service"]);
  const routes = operatorProfileRouteLayer.pipe(Layer.provideMerge(auth));
  const { handler, dispose } = HttpRouter.toWebHandler(
    mounted ? routes.pipe(Layer.provideMerge(profile)) : routes,
    { disableLogger: true },
  );
  disposers.push(dispose);
  return (path: string) => handler(new Request(`http://t3.test${path}`));
};

describe("operator profile diagnostics routes", () => {
  it("refuses the full answer without a session", async () => {
    const response = await fixture("none")(OPERATOR_PROFILE_ROUTE);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("/home/twr");
  });

  it("refuses the full answer to a session without read scope", async () => {
    const response = await fixture([AuthOrchestrationOperateScope])(OPERATOR_PROFILE_ROUTE);
    expect(response.status).toBe(401);
  });

  it("serves the full answer, identical to the receipt, to a reader", async () => {
    const response = await fixture([AuthOrchestrationReadScope])(OPERATOR_PROFILE_ROUTE);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
  });

  it("serves a summary with no values and no paths to anyone", async () => {
    const response = await fixture("none")(OPERATOR_PROFILE_SUMMARY_ROUTE);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("/home/twr");
    expect(text).not.toContain("effective");
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      host: "linux",
      counts: report.counts,
      rows: [
        {
          entry: "continueThreadsAfterServerUpdate",
          outcome: "applied",
          code: "APPLIED_OVER_DEFAULT",
        },
        { entry: "providerInstances.pi", outcome: "rejected", code: "LAUNCHER_MISSING" },
      ],
    });
  });

  it("answers 503 where the profile is not mounted", async () => {
    const response = await fixture(
      [AuthOrchestrationReadScope],
      false,
    )(OPERATOR_PROFILE_SUMMARY_ROUTE);
    expect(response.status).toBe(503);
  });
});
