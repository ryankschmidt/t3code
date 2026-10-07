/**
 * ThroughLine: the operator profile's diagnostics answer.
 *
 * - GET /api/throughline/operator-profile — the full report (effective settings for this host,
 *   plus what diverged), for a session holding orchestration:read.
 * - GET /.well-known/throughline/operator-profile — a summary with no values and no paths, so a
 *   health check that holds no credential can see whether the profile applied.
 */
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { OperatorProfile, type OperatorProfileReport } from "./OperatorProfile.ts";

export const OPERATOR_PROFILE_ROUTE = "/api/throughline/operator-profile";
export const OPERATOR_PROFILE_SUMMARY_ROUTE = "/.well-known/throughline/operator-profile";

const noStore = { "cache-control": "no-store" };

const notYetApplied = HttpServerResponse.jsonUnsafe(
  {
    error: "operator_profile_not_applied",
    message: "The operator profile is not mounted, or settings have not loaded yet.",
  },
  { status: 503, headers: noStore },
);

// Optional so route layers built without the profile (tests, tools) still compose.
const latestReport = Effect.serviceOption(OperatorProfile).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeed(Option.none<OperatorProfileReport>()),
      onSome: (operatorProfile) => operatorProfile.latest,
    }),
  ),
);

export const summarizeOperatorProfile = (report: OperatorProfileReport) => ({
  schema: "throughline.operator-profile-summary.v1",
  written_at: report.written_at,
  app_version: report.app_version,
  profile_version: report.profile_version,
  host: report.host.platform,
  ok: report.ok,
  counts: report.counts,
  rows: report.rows.map((row) => ({ entry: row.entry, outcome: row.outcome, code: row.code })),
});

const operatorProfileReportRoute = HttpRouter.add(
  "GET",
  OPERATOR_PROFILE_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* Effect.exit(serverAuth.authenticateHttpRequest(request));
    if (Exit.isFailure(session) || !session.value.scopes.includes(AuthOrchestrationReadScope)) {
      return HttpServerResponse.jsonUnsafe(
        {
          error: "auth_required",
          message: `A session with ${AuthOrchestrationReadScope} is required.`,
        },
        { status: 401, headers: noStore },
      );
    }
    const latest = yield* latestReport;
    return Option.match(latest, {
      onNone: () => notYetApplied,
      onSome: (report) => HttpServerResponse.jsonUnsafe(report, { headers: noStore }),
    });
  }),
);

const operatorProfileSummaryRoute = HttpRouter.add(
  "GET",
  OPERATOR_PROFILE_SUMMARY_ROUTE,
  Effect.gen(function* () {
    const latest = yield* latestReport;
    return Option.match(latest, {
      onNone: () => notYetApplied,
      onSome: (report) =>
        HttpServerResponse.jsonUnsafe(summarizeOperatorProfile(report), { headers: noStore }),
    });
  }),
);

export const operatorProfileRouteLayer = Layer.mergeAll(
  operatorProfileReportRoute,
  operatorProfileSummaryRoute,
);
