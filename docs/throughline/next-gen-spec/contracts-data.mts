// Second pass, Oct 8, 2026: the cross-cutting contracts every task inherits, the disposition of every audit item from the
// fidelity review (F01-F13), the architecture review (A01-A14), its addenda (A15-A18) and the slice-1 judge rounds, the
// disposition of every ledger item the task graph does not name, the five-device capability matrix and the whole-design
// acceptance node. Authored data; build-spec.mts folds it into spec.json and check-spec.mts refuses a spec that drops any of it.

export type Disposition =
  | "already-resolved"
  | "consequential-choice"
  | "bounded-repair"
  | "evidence-needed";
export interface AuditItem {
  id: string;
  source:
    | "fidelity"
    | "architecture"
    | "architecture-addenda"
    | "judge-round-2"
    | "shape-alignment";
  title: string;
  disposition: Disposition;
  overlaps?: string[];
  current_state: string; // what the 0.2.0 spec already does about it, checked on disk
  answered_by: string[]; // contract, decision, task or check ids that carry the answer
  opus_repair?: string; // the bounded correction an implementer makes, when disposition is bounded-repair
  repair_history?: unknown[];
  governing_shapes?: string[];
  evidence_test?: string; // the smallest test that resolves the uncertainty, when evidence-needed or when a choice needs proof
}
export interface Contract {
  id: string;
  title: string;
  statement: string;
  serves: string[];
  binds_slices: string[];
  binds_tasks?: string[];
  tests: string[];
  answers: string[];
  fable_call?: string;
  alternative?: string;
}
export type LedgerKind =
  | "implemented"
  | "inherited-constraint"
  | "external-capability"
  | "deferred-exploration"
  | "superseded";
export interface LedgerDisposition {
  id: string;
  kind: LedgerKind;
  by: string[];
  note: string;
  consumption_test?: string;
}
export interface DeviceCell {
  device: "mac" | "twr" | "rpi" | "ios" | "android";
  role: "execution-host" | "control-client" | "both";
  state: "required" | "not-applicable" | "deferred-exploration" | "deferred";
  owner?: string;
  test?: string;
  reason?: string;
}
export interface DeviceRow {
  capability: string;
  serves: string[];
  cells: DeviceCell[];
}

// ---------- the contracts ----------
export const CONTRACTS: Contract[] = [
  {
    id: "K01",
    title:
      "The record and effect contract: admitted command, immutable event, effect attempt, projection cursor",
    serves: [
      "NG-002",
      "NG-003",
      "NG-004",
      "NG-005",
      "NG-007",
      "NG-009",
      "NG-010",
      "NG-011",
      "NG-012",
      "NG-137",
    ],
    binds_slices: ["slice-3", "slice-4", "slice-7", "slice-8", "slice-11"],
    statement:
      "Four things are recorded separately in the one Postgres: an admitted command (stable command id, admission provenance the engine signs, never a payload flag), an immutable event (append-only, ordered per conversation), an effect attempt (stable effect id, attempt number, lease and execution generation, outcome in {succeeded, failed, unknown}) and a projection cursor (per consumer, idempotent replay). Accepted-event write and execution enqueue are one transaction (outbox). An effect whose process dies after the external action and before its outcome is written is recorded unknown and is never silently repeated; a non-idempotent unknown effect stops the request and surfaces it. Blobs over the step size live in a blob table with custody and retention stated. The screen store is a projection rebuilt from events by cursor. The admitted command of a turn is an Absurd 0.5.0 run; every managed model request, tool start and provider callback is a step of that run whose id is minted before execution and carried by the action (token, hook payload, extension context); suspension is a durable event wait on the run; replay from a checkpoint re-executes no step whose outcome is unknown or terminal. A record cutover between hosts is a fenced, receipted operation: the source admission refuses with a visible reason, in-flight effects reach terminal or unknown before any copy, rows merge under their existing identities with zero conflicts asserted, every imported key is ledgered so rollback is exact, and a staging copy never has a worker or an admission path.",
    tests: [
      "kill the process at every boundary (before admission, after admission before enqueue, after enqueue before effect, after effect before outcome, after outcome before notification): duplicate submission yields exactly one admitted command and no repeated non-idempotent effect",
      "delete the UI projection and rebuild the same ordered history",
      "restore from a snapshot plus the event log and compare projections",
    ],
    answers: ["A03", "F05"],
    fable_call:
      "Chosen over turning arbitrary callbacks into the event schema: the existing event vocabulary and the Absurd package stay; the authoritative persistence boundary moves behind one narrow port in the fork namespace.",
  },
  {
    id: "K02",
    title:
      "Lifetimes are not shared: conversation, request and target keep distinct ids and states",
    serves: ["NG-013", "NG-014", "NG-015", "NG-019", "NG-020", "NG-021", "NG-022", "NG-073"],
    binds_slices: ["slice-3", "slice-7", "slice-9", "slice-10"],
    statement:
      "A conversation (thread) has a long-lived identity. Each request inside it is its own short Absurd workflow correlated by request id and generation, under the conversation identity, so idle conversations hold no worker slot. Five states are distinct and never collapse: ACK (durably accepted), progress, ordinary reply, operation terminal result, and verified completion (independent acceptance, K08). A reply never completes a target; only an acceptance event does. Waits are durable event waits keyed by request id and generation; a late or duplicate reply to a closed generation is recorded and ignored. Absurd is pinned to 0.5.0 for the substrate slice (the lab version with durable event waits); the 0.4.0 to 0.5.0 migration is a named task with its own test, never implied.",
    tests: [
      "saturate worker concurrency, then send reply-before-wait, duplicate reply, late reply, timeout then reply, cancellation then result, and two simultaneous asks in one conversation: exactly one intended resume per request and no false target completion",
      "pinned-version test showing bounded replay and memory with one request workflow per ask",
    ],
    answers: ["A04"],
    fable_call:
      "Request-scoped workflows under a conversation identity, the reviewer's simpler alternative, chosen over one long-lived task per thread; D17 is amended to pin 0.5.0.",
  },
  {
    id: "K03",
    deferred_tasks: [
      {
        id: "T3.06",
        slice: "slice-3",
        action: "foundation-proposal",
        detail_state: "outline",
        title:
          "Controlled executor for live shell input: terminal input through the one admission service",
        serves: ["NG-007", "NG-035", "NG-198"],
        what: "A typed executor in the fork namespace that owns the shell session for a thread (the same session the terminal drawer tool of K14 reaches), accepts each line of input through the admission service (I-01) with the thread's generation, and refuses input that would write a protected path while check-first is pending; it is a client of I-01, never a second scheduler. Until it ships, the live-input cell stays observe-only. On the Mac the controlled executor is the only live-input path for a bound seat; until it ships the Mac execution-row cell for live input reads observe-only.",
        files: [
          {
            path: "packages/throughline-executor/",
            side: "fork-namespace",
            action: "add",
            exists_now: false,
          },
        ],
        interfaces: {
          consumes: ["I-01"],
        },
        signatures: [],
        done_when: {
          command: "the K03 live-input counterexample, run through the controlled executor",
          expect:
            "refuses the protected-path edit before it runs, counted by stable id; the same input through a plain provider shell is still recorded observe-only",
          judge: "non-builder seat",
        },
        depends_on: ["T3.01", "T3.02"],
        executor: {
          role: "implementer",
          model_preference: "gpt-6.1-sol",
          effort: "high",
        },
        governing_shapes: [
          "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
          "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
        ],
        rollback: "the executor is removed; the cell returns to observe-only",
        risk: [],
        window_estimate: "not estimated: outline",
        device_cells: [],
        proof_limits: [
          "Outline: live shell input stays observe-only on every provider until this task ships.",
        ],
        annotations: {
          source_proposal:
            "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/closeout-2026-10-09/Fable-Delta-Enforcement.json",
          numbered:
            "T3.06 by lead order; the delta calls it T3.04, which is the existing Absurd 0.4.0 to 0.5.0 task",
          mac_note:
            "On the Mac the controlled executor is the only live-input path for a bound seat; until it ships the Mac execution-row cell for live input reads observe-only.",
        },
        planned_checks: [],
        failing_checks: ["PH2-C01"],
        reviewer: {
          role: "reviewer",
          model_preference: "gpt-6.1-sol",
          effort: "high",
        },
        deferred: {
          state:
            "deferred outside the first-install required graph: not a member of slice 3, no task depends on it, not an input of ACCEPT-ALL",
          why: "Fable chose the controlled executor as later work (Fable-Delta-Enforcement.json, B02 first_install); the exit check P2-01 found it inside the required graph.",
          enters_required_graph_when:
            "a first-install host exposes live shell input to a bound seat; then it is detailed and required before that host is certified (K03 unchanged)",
          source: "execution/phase-02/closeout-2026-10-09/P2-Exit-Check-0.4.0.json defect P2-01",
        },
      },
    ],
    title: "Provider enforcement is a measured capability matrix, never an assumed veto",
    serves: ["NG-029", "NG-035", "NG-036", "NG-037", "NG-038", "NG-039", "NG-144"],
    binds_slices: ["slice-8", "slice-11"],
    statement:
      "For each provider (Claude through the mod, Codex through its approval policy and CLI, Pi through the wrapped loop) and each operation class (pre-model admission, pre-tool veto, post-tool observation, cancellation, compaction, native resume, model routing through the access broker), the matrix states supported, observe-only or unsupported, with the hook or policy that proves it. An unsupported enforcement class is refused for that provider or declared observational; parity is never invented. The matrix is measured under the real launch policy before the binding slice is called done, and re-measured at every provider version pin. The operation-class matrix carries one more row per provider: headroom read, satisfied by the access broker's credential-free observer (never by an agent-side counter), with the observed reset time and freshness; a provider route that cannot read headroom is marked observe-only for that row, never blocked. The execution cells of the device matrix are owned per provider: the Claude binding (T8.01), the Codex binding (T11.02) and the Pi binding (T11.01); the model route (T11.03) owns only the claim that the picker shows the model that answers. Shell is two cells, never one: shell start (pre-veto supported where the provider's hook fires before the command, counted) and live shell input (write_stdin, persistent shell input, hosted or specialized tool paths that bypass hooks), which is unsupported for pre-veto on every provider and is bound at the effect instead. Every shell session is an effect attempt (K01) with outcome unknown until the writes it produced are reconciled from the host's record of changed paths; safety is never inferred from the working directory or from the approval that started the session. A thread whose check-first is pending cannot be computed done while a shell session it started is open or carries unreconciled writes (K08, K10). The enforced live-shell cell exists only through the controlled executor of T3.06, a client of the one admission service; until T3.06 ships the cell reads observe-only, and no report calls live shell input gated. Model-request admission is a separate operation class from turn admission. Its enforced mechanism on every provider is the access-broker route: a request is forwarded only with an admission token minted by the one admission service for the thread, turn and execution generation (K04), verified by the broker on each request, and refused without it or with a stale generation; auxiliary and plugin-originated model calls carry the same token because they use the same route. Provider-side hooks for model requests are observe-and-annotate only and are never counted as the gate. A host where model traffic can reach a provider without the broker route is not an execution host (K05). A matrix cell counts as bound only when the action carries a step id minted before execution and its outcome is written to that step; a cell whose binding is observation after the fact reads observe-only and never satisfies NG-035, NG-036 or NG-038, and a device cell of the execution row passes only when every operation class a bound seat can reach is bound or unavailable to that seat.",
    tests: [
      "under the real launch policy, run allowed and approval-requiring shell, edit, read, MCP and nested-tool calls and model requests on all three providers; drop the record connection immediately before each; count requested, admitted, executed and recorded actions by stable id; every cell of the matrix is a measured count, not a claim",
      "Controlled exhausted/reset/unknown/stale observer and provider responses traverse the real headroom/dispatch consumer; no real subscription is deliberately depleted and no configured identity disappears",
      "shell-start veto: under the real launch policy on each provider, a shell start that the admission service refuses never executes, counted by stable id; a provider whose hook fires after the command is marked observe-only for this cell",
      "live-input counterexample: with check-first pending, a Codex seat starts an admitted shell and then writes a protected-path edit through stdin; the design must record the write as an observed effect with no veto claimed, and the thread's done computation must refuse until a non-builder reconciles the effect; any report that calls the input vetoed fails",
      "per-model counterexample: a Pi seat whose before_provider_request extension throws, a Claude plugin-originated model call, and a Codex turn each send a request with no token or a stale generation; the broker refuses all three and records the refusal by request id; a request with a valid token is forwarded and recorded",
      "route exclusivity: on the tower, the provider net rule admits model traffic only through the broker unit; on the Mac, the app's provider base address is the broker tunnel; a direct provider connection from a seat fails",
    ],
    answers: ["A05", "F05"],
  },
  {
    id: "K04",
    title:
      "A durable public agent identity is bound to an execution generation; an account is not an identity",
    serves: [
      "NG-055",
      "NG-058",
      "NG-060",
      "NG-061",
      "NG-062",
      "NG-067",
      "NG-068",
      "NG-175",
      "NG-197",
    ],
    binds_slices: ["slice-5", "slice-6"],
    statement:
      "The public agent id outlives any account or process. Each launch binds it to an execution generation: the dynamic uid, the systemd invocation id, the cgroup and the process start. Registration, results and socket peers carry the generation; a replayed registration or a late result from a replaced generation is refused. Durable home and transcript ownership, cleanup order (results drained, endpoint closed, unit stopped, account removed), revocation and crash resume are stated per launcher. Under the task-workspaces profile (PrivateNetwork, ProtectHome, private StateDirectory) the harness reaches only the broker socket and the messaging socket the launcher passes in; no TCP broker, no peer discovery through another account's home. The Mac adapter binds the same public id to the app's keychain-held identity and is weaker by declaration. The launcher and supervisor exist on every Linux execution host, each with its own installed identity receipt and provider receipt; a host without its own receipts has no launched seats, and a tower receipt never stands for the Raspberry Pi. Generation membership is attested by the root-owned supervisor registry on the execution host: a connecting process is a member when its cgroup matches an active entry, its uid equals the entry's dynamic uid, and its own start time is at or after the unit start and unchanged across the check; harness-spawned children are members by cgroup; anything launched outside the supervisor is refused; the invocation id is read from the entry, never from a pathname. The ThroughLine server and the record each run as their own locked service account on the tower as system units; root owns their files and the record role credential and does nothing at runtime; the server reads the credential only through its unit's credentials directory; neither account has a shell, a password or sudo; the twr account owns nothing the server or the record needs.",
    tests: [
      "kill, restart and recycle a unit, then replay its old registration and its old result: both refused",
      "under the exact isolated profile, each of the three providers reaches only the permitted broker and socket paths, with no credential and no sudo",
    ],
    answers: ["A06", "F10"],
  },
  {
    id: "K05",
    title:
      "Connectivity, authentication and permission to execute are three states; no second execution authority",
    serves: ["NG-008", "NG-016", "NG-018", "NG-025", "NG-069", "NG-129", "NG-143", "NG-195"],
    binds_slices: ["slice-4", "slice-7", "slice-12"],
    statement:
      "Cross-device messaging and thread work on every device role is a required outcome, not an exploration; only the transport is a design choice. The existing ThroughLine pairing transport is the adapter to the one admission service on the tower; the HTTP-and-SSE hub is adopted only if it supplies a transport function pairing lacks. When the tower record is unreachable: no new durable execution anywhere, cached history shown as stale, drafts kept as unsubmitted, no Mac scheduler and no Mac database. On lease loss an executor stops new effects, records unknown outcomes and resumes only from the same authority. Without Tailscale, the preserved route is the Cloudflare tunnel to the tower service (the path Ryan requested) or a replacement he authorizes; it reaches the same admission service, never a fallback authority. The Mac keeps no Postgres credential an agent can read: the app-only keychain entry is proven by a test that a Mac-local agent cannot read it. Permission to execute a model-backed turn consults the broker's observed headroom: unknown or stale never blocks, known-empty is not retried until the observer reports a reset, and the waiting request stays a wait row; no cap, quota or per-consumer meter exists anywhere in ThroughLine, which the Sep 30 no-limits ruling forbids. Pairing and its renewal are performed by the adapter or launcher from a credential the access broker holds; a client whose login expired is re-paired without Ryan typing a token; operator-reserved acts are derived from current owning platform contracts and actual capabilities, each with cited Ryan authority and its alternative; an agent-capable tap stays agent-owned. Retire the Mac database service only after T4.03’s non-builder keep-alive and independent Raspberry Pi loss/notification receipts all pass with laptop closed and tower unavailable; both observer delivery and notify.push/grant are required prerequisites. The Raspberry Pi observer writes its own status/loss record locally and uses the local broker-service capability and phone route over LAN, never tower admission or a tower proxy; no lost tower record is needed to report its own outage. The Mac habitat job is only a second transition observer; Health Hub and x-registry are retired and never acceptance evidence. Injected crashes recover by the actual unit policy on disposable rehearsal; intentional maintenance stops stay down, are reported and restore explicitly. No shared live-database fault probe. The tower passes through three declared states and no surface may claim more than the current one. Before T4.06: shared-account, the twr account owns the record, its unit and its server role credential, and any twr seat can stop or alter them; nothing about binding, isolation or custody is claimable. After T4.06 and before T6.02: record-isolated-seats-shared, the record and the server run as their own locked service accounts under system units, the credential is root-owned and loaded only into the server unit, so no twr seat can stop the record or read the credential, and credential custody on the tower is claimable; but seats still share the twr account with each other and with the human account, have no execution generation, and can read one another's files, so agent binding and seat isolation are not claimable; the Mac cutover (T4.02) may run in this state because the record it targets is already outside the seats' reach, and the Mac path stays restorable until Phase 6. After T6.02: authority-isolated, reached only by the T6.02 receipt that shows no harness process owned by twr and the K04 reach test passing; every claim is then available. Permission to execute protected effects is a launch property: a seat launched for a thread with check-first pending runs with the protected roots read-only at the OS level, and the transition to build-allowed is a relaunch with a new execution generation (K04); detection after a write never substitutes for this. During a cutover the fenced source is not a second authority: its admission refuses, its worker holds no lease, and after the switch the fence is permanent; the Raspberry Pi general-record cutover is deferred under IC-008; the bounded recovery island described below is never merged and is not a second authority for ThroughLine work. The supervisor registry is written only by root on its host and read by that host's server; it is attestation of membership, not an authority to execute, and it reaches the admission service only over the host's existing authenticated record connection. Loss of the tower record is answered by a deterministic ladder and then by a responder agent on the always-on Raspberry Pi, launched through the local broker's wake capability as a visible thread on the Raspberry Pi's own ThroughLine server with model access through the Raspberry Pi's own provider broker, never through the tower; Ryan receives information at open and close and is paged, with exactly one act named, only when no responder can be launched or reached, when the responder exhausts its authority, or when the host is unreachable; one incident per target, one responder at a time, no reboot by any agent without Ryan's yes. The tower's disk is encrypted and unlocked only by Ryan at the KVM after a reboot; no agent reboots the tower without his yes in the current conversation; reboot-survival on the tower is proven by bootout-and-bootstrap of units, never by a reboot; an unreachable tower is classified as planned-reboot-waiting-for-unlock or unreachable-unplanned, both stop repair and page Ryan with the one act, and neither is reported as broken. One bounded exception exists and is owned by T12.08: while an incident is open on the Raspberry Pi watcher's ledger, the Raspberry Pi's own ThroughLine server and its local record form the recovery island, which admits exactly one thread kind, the responder, whose effects are limited to the responder authority list and whose every step is appended to the tower record as events when the record returns; the island admits nothing for the one record, is never merged into it, admits nothing outside an open incident, and is not an execution authority for ThroughLine work; a responder step that needs the tower record is recorded unknown and surfaced, never executed on the island.",
    tests: [
      "partition phone to Mac, Mac to tower, broker to provider and tower to database separately during submission and during execution: displayed state matches durable state and no second worker performs a fenced effect",
      "Installed owning-app boolean diagnostics and a fixed non-secret canary prove ACL equivalence/access denial; real consumption is server-side; no real keychain or process-argument inspection",
      "T4.03 non-builder rehearsal: automatic crash recovery is separate from sustained injected loss through the real observer consumer; intentional maintenance stop is reported, remains down and restores explicitly; Raspberry Pi loss row plus phone push work with laptop closed and tower/record unavailable; absent grant/delivery proof refuses cutover",
    ],
    answers: ["A07", "F12", "IA-07"],
    alternative:
      "Direct per-host Postgres roles over the tailnet for every client (D04 keeps that for the Mac app itself); kept only while credential custody and lease fencing hold.",
  },
  {
    id: "K06",
    title: "Recovery and rewind bind to a generation cut, never to a good summary",
    serves: ["NG-094", "NG-095", "NG-096", "NG-098", "NG-099", "NG-196"],
    binds_slices: ["slice-8", "slice-10"],
    statement:
      "A re-entry packet names the committed sequence cut, the target revision, the execution generation, the native-session handle and the unresolved-effect set. Release is an atomic compare-and-release against the current cut: a stale packet never releases. Code checks positive prerequisites; the absence of a semantic objection is never a release predicate (JEV bounces, never releases). Rewind changes the active conversation branch only; external effects and audit history are untouched. A rewind accepted while the provider is in error is shown as pending, never lost. The re-entry packet carries the shape statements that govern the successor's next acts, resolved by code from the trigger-moment index with supersession applied, with full current text and source identity, and records their ids; a packet whose acts match a shape it does not carry is refused by the compare-and-release.",
    tests: [
      "inject a target change, a tool completion, a missing blob and a cancelled execution between precompute and the cut: the stale packet never releases",
      "rewind to the first turn repeatedly on every provider and both phones without changing any file",
      "A next-act slice-finished re-entry carries the full current judge-not-self shape, exact source/hash and delivered ids; stale/superseded/missing shape refuses compare-and-release",
    ],
    answers: ["A08", "IA-16"],
  },
  {
    id: "K07",
    title:
      "One typed JEV condition capability; a confidence number is a parameter, never authority",
    serves: [
      "NG-051",
      "NG-077",
      "NG-078",
      "NG-085",
      "NG-086",
      "NG-087",
      "NG-089",
      "NG-091",
      "NG-093",
      "NG-176",
    ],
    binds_slices: ["slice-8", "slice-9", "slice-10"],
    statement:
      "One condition-evaluation port in the fork namespace, reused by targets, re-entry and delivery; it reuses the jev-experiments 0.9.0 typed recipe repertoire rather than a new catalog. Every call carries a question version, state-builder version, model and policy; answers are typed and validated; no-answer, timeout and refusal are distinct outcomes; results are cached by input hash plus generation and versions; independent questions are batched; retries carry request and attempt identity; latency and outcome are recorded. Code is the sole authority: a JEV answer classifies, it never admits a target, closes a thread or releases a seat. The target-promotion threshold starts at 0.80 as an unevaluated parameter and governs only after the calibration test below; no quota is invented. Placement (NG-087, NG-088, NG-089): the same port is bound at level 6 to the tool inputs, tool results and outgoing model requests the provider adapters intercept (the Claude mod, the Codex native hooks and approvals, the Pi admission extension), at level 7 to turn ends (unfinished work, clarification, target change), and to ComsNet socket sends and replies (T7.03); never to stock-provider activity observed afterwards. Every call and answer is an Absurd step on the request's own workflow carrying source ids, question version, model and confidence, so a retry reads the recorded answer instead of calling again. JEV classifies and annotates; code decides.",
    tests: [
      "a labelled corpus of real first messages, quotes, questions, retractions and agent-to-agent asks: measure false promotion, false omission, abstentions, p95 latency and cost at 0.80 and two neighbours; record the chosen value with its error costs",
      "malformed answers, outage, duplicates and cache invalidation after a rewind each produce the named outcome",
    ],
    answers: ["A09", "A17", "F07", "IA-14"],
  },
  {
    id: "K08",
    title:
      "Durable work before a target; admission by code after JEV; acceptance by a named non-builder, never Ryan by default",
    serves: [
      "NG-074",
      "NG-075",
      "NG-076",
      "NG-079",
      "NG-080",
      "NG-081",
      "NG-082",
      "NG-083",
      "NG-138",
      "NG-139",
    ],
    binds_slices: ["slice-9", "slice-10"],
    statement:
      "A thread's work record exists from its first message, with the state exploring, and is durable before any target is admitted. The first message is the default candidate; JEV answers; code admits a target only when the typed answer clears the parameter and no agent correction is pending; a declined candidate leaves the thread exploring and JEV re-asks only when the thread's own text changes. Targets have revisions; agents hold tools to add, fix and retract a target and every change is an event. Acceptance of a check belongs to a named seat that did not build the work: the dispatcher of the thread names it at dispatch, else the manager names a judge; it is never the builder and never Ryan unless he names himself. Check-first scope, decided here: building and marking done wait for the failing check; launching seats, writing designs, dispatching and exploration do not. At target admission the admitted target carries the shape ids its first acts match, resolved the same way; the agent's tools to fix a target may add or remove a shape with the change recorded as an event. Building is decided by code from engine-typed facts: an effect whose kind writes, patches, executes, installs or releases inside the admitted target's declared scope or a registered product root; marking done is a done-claim or acceptance effect; both are refused per effect, not per turn, until the failing check is recorded; an opaque effect that could touch that scope runs only through an enforced read-only or test path or is refused with a usable alternative; post-tool detection is never counted as prevention; no caller-supplied label changes the classification. T9.01 owns one common read/add/fix/retract interface; Claude, Codex and Pi delegate through it. Installed target-ID-only startup and partial-work succession, with stale-revision, self-acceptance and direct-write refusals, are required in ACCEPT-ALL.",
    tests: [
      "a thread with no admitted target runs three turns, writes a file and dispatches a seat: all recorded, nothing stalled, no target saved",
      "a builder attempts to accept its own check: refused; the named judge accepts: recorded with the judge's identity",
      "T9.01 target_only_start: every supported provider on each active execution host; job input only target_id; exact current Ryan words and checks; partial work crosses replacement without manual handoff.",
    ],
    answers: ["F06", "F10", "IA-08", "IA-14"],
  },
  {
    id: "K09",
    title:
      "Five devices are capability contracts, not five packages; Android is in the contract now",
    serves: ["NG-104", "NG-105", "NG-108", "NG-119", "NG-142", "NG-182"],
    binds_slices: ["slice-10", "slice-11", "slice-12", "slice-13"],
    statement:
      "The device matrix below is part of the spec: each capability row names its state on each device role (execution host or control client), its owner task and its cold test; a not-applicable cell carries a role reason. Protocol and capability negotiation, a minimum supported client, tolerant event decoding, cursor replay, duplicate command ids and expand-then-contract database migrations are specified before substrate and client work, so same-release convergence tolerates store and TestFlight delays. Android evidence is tracked at six levels, each with its own dated receipt: setup, authentication, build, signing, publishing and native-device behavior; an authentication receipt never stands for the platform. Pairing/install/permission tests read the current platform and device-grant contracts; no model/OS install behavior or exhaustive operator-prompt list is frozen into this matrix. IC-008 pauses Raspberry Pi general installation/execution/device acceptance. Required targets are Mac, tower and iOS first, then Android; deferred hardware rows remain explicit and cannot count as passed. The archive drive and the rpi-account watcher/responder under T12.08 are the only hardware exceptions. Pi software-provider tests on active hosts remain required.",
    tests: [
      "old client against new server and new client against old server: send, reconnect with a stale cursor, repeat rewind, receive a late reply, preserve settings and voice text",
      "per device: the matrix row's cold test fired by a non-builder on the real device; simulator and emulator runs are pre-proof, labelled with their proof level, and never satisfy a phone cell",
    ],
    answers: ["F03", "F13", "A11", "A16", "IA-15"],
  },
  {
    id: "K10",
    title:
      "Whole-design acceptance is separate from per-slice release and requires every required disposition",
    serves: ["NG-119", "NG-120", "NG-139"],
    binds_slices: ["slice-13"],
    statement:
      "Every slice ships through the pipeline as its own release. The whole design is accepted only by the acceptance node: a conjunction over every detailed task's done check, every slice's state detailed, every implemented ledger disposition's acceptance proof and every required device cell's cold test. The checker tests the combined task, slice and precondition graph and refuses the acceptance node while any required input is open; the map draws it. Releases are judged against the target set each one declares, never retroactively against a later five-target contract; the receipt-level verdict comes from one evaluator, the accept-all mode of throughline-ship, run by a non-builder, separate from the structural check X14. IC-008 pauses Raspberry Pi general installation/execution/device acceptance. Required targets are Mac, tower and iOS first, then Android; deferred hardware rows remain explicit and cannot count as passed. The archive drive and the rpi-account watcher/responder under T12.08 are the only hardware exceptions. Pi software-provider tests on active hosts remain required.",
    tests: [
      "hold one required task incomplete: whole-design acceptance refuses while an ordinary compatible slice release still passes",
    ],
    answers: ["F08", "A15"],
  },
  {
    id: "K11",
    title: "Upstream maintenance is measured by contract coverage, not file count alone",
    serves: ["NG-123", "NG-124", "NG-125", "NG-126", "NG-130"],
    binds_slices: ["slice-2"],
    statement:
      "The seam manifest binds to pinned upstream and fork SHAs and to the real diff; it records, per upstream edit, its reason, its seam side, the private symbols it imports and the schema assumption it makes. Each fork feature keeps a pinned behavioral test (the rewind capability manifest stays); a sync is admitted only when every pinned test is green. An adopt/retain/replace/defer table is kept per upstream change; the unclaimed-conflict rule is never take-upstream for a path under a capability manifest. The edited-upstream count still only falls (Ryan's control); it is one of the measures, not the only one. T3.07 is the first Phase 4 task. 0.0.60 stays preserve-base; final architecture installation requires a fresh pinned upstream head/time, exhaustive dispositions, source-backed conflict decisions, unchanged ceilings, passing capability regressions, and installed-source ancestry or explicit deliberate non-inclusions.",
    tests: [
      "in a fixture, change an optional protocol field, a provider event shape, an upstream component prop and a scope enum: every adapter fails explicitly or stays compatible, and every kept fork capability test runs",
    ],
    answers: ["A10", "A18", "IA-11"],
  },
  {
    id: "K12",
    title: "Releases resume from effect state, never by rerunning or moving start markers",
    serves: ["NG-120", "NG-121"],
    binds_slices: ["slice-1", "slice-13"],
    statement:
      "Every pipeline step carries a stable operation id and attempt number, a lease, a typed retry class (idempotent, reconcile-then-retry, never-retry) and input digests (lockfile, toolchain, architecture, flags); an interrupted step reconciles from its own receipts and resumes without a duplicate upload or install. Simulator and device resources are namespaced per run. Build fan-out is separate from gated distribution and install. The move-and-release of slice 1 uses one owned admission record with three states, frozen, moved, closed, read by the pipeline and the checks (K17). Two routes never share a gate: the routine-release route keeps the operator-presence step for an install quit; the health-recovery route restarts a stalled server, worker or database on any host without consulting presence, preserves drafts, writes a recovery receipt and sends the same courtesy message after the restart; neither route has a skip flag.",
    tests: [
      "interrupt each step before and after its side effect and before its receipt; resume without a duplicate upload or install",
      "new payload against old data, prior payload against migrated data, restore fallback: compatibility and data-loss implications reported, no blanket rollback claim",
    ],
    answers: ["A12"],
  },
  {
    id: "K13",
    title:
      "Publication is atomic and honestly labelled: one editable source, one read-only generation",
    serves: ["NG-122"],
    binds_slices: ["slice-1"],
    statement:
      "The repository is the only editable source; the vault copy is a read-only generation written as a sibling staging folder then swapped by two renames with restore-on-failure, so readers see one complete generation. The manifest records the source commit and the installed release separately. Existing frontmatter is merged, never duplicated. Relative links are rewritten and validated without changing quoted content. An explicit allowlist, not a broad glob, selects files: a recursive root such as docs/** is admitted only with its expanded file list and its exclusions recorded in the generation manifest. On the Mac the staged generation replaces the current one in one atomic directory swap (renamex_np with RENAME_SWAP on APFS, through a small helper); where that call is unavailable, the two renames are used and every publisher start, and the vault-clean step before every release, first restores <destination>.previous when <destination> is missing, so a process killed between the renames never leaves readers without a complete generation after the next start. Archived artifacts keep a relocation index with a restore test before any local rollback material is removed.",
    tests: [
      "publish with differing source and installed revisions, a file with existing frontmatter, a broken relative link and a crash halfway: readers see one complete generation",
      "restore one archived artifact through the relocation index and verify its original digest",
    ],
    answers: ["A13"],
  },
  {
    id: "K14",
    title: "UI, terminal and voice consume the shared contracts and never become authorities",
    serves: [
      "NG-071",
      "NG-084",
      "NG-103",
      "NG-106",
      "NG-108",
      "NG-109",
      "NG-110",
      "NG-180",
      "NG-187",
      "NG-192",
      "NG-198",
    ],
    binds_slices: ["slice-9", "slice-10"],
    statement:
      "Raw authored content is immutable; formatted delivery is a projection and missing-detail requests are appended. Terminal actions go through the same scoped admission as every other effect, with exploration and acceptance distinct. Voice keeps the raw transcript and exposes optimization status; the Message Optimizer obligations are carried whole: the full original process on the tower, one central log, the model-or-Off preference, selected-text or full-draft optimization, and original-plus-undo preservation. The waiting app features are carried as tasks in the ledger's words: on iPhone, Return inserts a newline and only the send arrow sends; Command+Shift+V pastes inline on the Mac; side chat attaches to any thread; vault links in chat open the link-router page; the vault viewer's copy button copies a page's whole contents (NG-187); the turn-budget refusal is removed from the running apps; attachment limits are the app's own setting; a new thread starts machine-first with a sensible folder per device. Needs-you and lineage derive from admitted events; a semantic suggestion is advisory. A standalone voice app, system-wide iPhone dictation, a Pi image extension and a native tool for a thread's own terminal drawer stay optional explorations; terminal actions, when built, go through the same scoped admission. The delivery seam attaches the shape statements that govern an act Ryan is being asked to take or a claim being made, as an appended missing-detail request, never a rewrite of the author's text. a versioned application-intent source carries every curated setting; a change on one host is an event the per-host adapters apply to every eligible host in the same act, with the effective state observed back and drift reported; privileges, credential access and intentional device differences stay outside parity; the Pi provider's model list is derived from the union of the Claude and Codex lists.",
    tests: [
      "a stale mobile action, another account's terminal id, a formatter timeout and a voice-optimizer outage: none alters authority and none loses raw text",
      "the same user action compared on all five device targets",
      "A curated setting change on one host is an admitted event applied without a release to every eligible host; read effective state and drift/rollback; exclude privileges, credential access and intentional device differences; Pi offering is the runtime union of the curated Claude and Codex lists",
    ],
    answers: ["A14", "F04", "IA-10"],
  },
  {
    id: "K15",
    title:
      "Source fidelity: every decision names the role of its quote, and complete governing clauses",
    serves: ["NG-041", "NG-052", "NG-062", "NG-119", "NG-138", "NG-196"],
    binds_slices: [],
    statement:
      "Each decision carries, beside its byte-true quote, a source role: requirement (Ryan's words state the requirement), adopted-proposal (an agent proposed and Ryan approved by continuing), approving-context (a genuine quote that does not itself state the decision) or fable-mechanism. A decision whose quote is approving-context names the message where the requirement or approval actually sits, and an outside reader confirms the pairing (evidence needed, below). Excerpts that cut a negation or qualification are replaced by the complete governing clause; prior excerpts are kept in history. The ledger's glossary definitions are versioned with the dated old sense preserved; that edit is a ledger task with authority, not a spec edit.",
    tests: [
      "an outside reader checks each decision's quote against its decision and marks supports, approving-context or wrong; zero wrong before the manager starts slice 2",
    ],
    answers: ["F01", "F07", "F10", "F11"],
  },
  {
    id: "K16",
    title: "Every ledger item has a disposition in the spec; the checker refuses a missing one",
    serves: [],
    binds_slices: [],
    statement:
      "Each of the ledger's items is implemented by named tasks or contracts, an inherited constraint, an external capability with a consumption test, an explicitly deferred exploration, or superseded with the authority named. The builder derives implemented from the serves fields and reads the rest from the authored list; the checker refuses a spec in which any item has no disposition, and refuses an implemented item with no acceptance obligation. The map joins stay the ledger's; the two misleading Raspberry Pi joins are corrected in the ledger by a bounded repair with authority, not regenerated.",
    tests: ["delete one disposition entry from the authored list: the checker refuses"],
    answers: ["F02", "F09"],
  },
  {
    id: "K17",
    title: "Slice-1 ordering: three admission states, stage-scoped checks, closure recorded last",
    serves: ["NG-120", "NG-122"],
    binds_slices: ["slice-1"],
    statement:
      "The move record carries an admission state: frozen (after T1.01 and T1.02), moved (after T1.03 and T1.04: the pipeline is executable from the new home and the acceptance release 0.0.60 is admitted), closed (after T1.10 and the final joined check). The pipeline's preflight refuses when the state is frozen and admits when it is moved; the release hold is this record, not completed_at. Release exclusion is the same record: a release in flight writes its run id into it and the move refuses while one is present; the pgrep probe is advisory only. Intermediate tasks have stage-scoped done checks (the repository at its home, worktrees exactly as mapped, pipeline validated) and the complete-vault-cleanup predicates belong to the final joined check in T1.07, which runs before completed_at is written and attests the order. Records (move record, archive ledger, probes) and build roots are distinct path classes; the validator forbids build roots under the vault and allows records under the component's records folder.",
    tests: [
      "state transitions frozen to moved to closed with a release attempted in each: refused in frozen, admitted in moved, refused in closed; a stale run id blocks the move",
      "the prescribed real pipeline definition passes the validator as a positive case",
    ],
    answers: ["A01", "judge-round-2"],
  },
];

// ---------- the disposition of every audit item ----------
export const AUDIT: AuditItem[] = [
  {
    id: "IA-06",
    source: "shape-alignment",
    title: "Watch the sole record before retiring the old one",
    disposition: "consequential-choice",
    answered_by: ["K05", "T4.01", "T4.03", "T4.02", "T12.01"],
    current_state:
      "Applied from execution/phase-02/Alignment-Delta.json with Alignment-Delta-Review.json corrections A–D; actual twr user unit, independent Raspberry Pi owner and required notification/delivery receipts; cutover unaccepted until non-builder proof.",
    evidence_test:
      "Three non-builder receipts: injected crash returns automatically with NRestarts increased and signal/restart journal evidence; sustained controlled loss is durably visible off-host and actually delivered to the phone while Mac and tower are unavailable; maintenance stop stays down, is reported as intentional with Result=success/NRestarts unchanged, and is restored explicitly. A fast restart alone does not promise a sampled loss row. Any missing observer delivery/notify.push grant receipt leaves cutover unaccepted, never a conditional PASS.",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-03-ryan-durability-is-a-running-watched-layer-not-answers-in-a-readme.yaml",
    ],
  },
  {
    id: "IA-05",
    source: "shape-alignment",
    title: "Brokered execution needs one shared view of real headroom",
    disposition: "consequential-choice",
    answered_by: ["K03", "K05", "T11.03", "T6.02", "T12.01"],
    current_state:
      "Applied from execution/phase-02/Alignment-Delta.json with Alignment-Delta-Review.json corrections A–D; all configured broker identities and controlled exhausted/reset consumer tests, no frozen count or depletion.",
    evidence_test:
      "Inject a controlled known-empty observer/provider response through the real consuming dispatch path; never spend down an account. Fail if: dispatch selects that account again before the observer reports a reset (the Sep 16 measured case, 28 selections in 11.5 hours); or the Limits panel shows fewer than the all currently configured identities or no freshness; or any code path refuses a turn because of a count ThroughLine keeps itself; or a stale observer reading blocks a turn.",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-16-ryan-brokered-resources-carry-one-visible-headroom-ledger-not-ad-hoc-tools.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-30-ryan-jev-and-model-calls-have-no-limits-unless-ryan-mints-one.yaml",
    ],
  },
  {
    id: "IA-02",
    source: "shape-alignment",
    title: "Make governing shapes arrive with the action, not merely with onboarding",
    disposition: "consequential-choice",
    answered_by: ["K06", "K08", "K14", "T8.02", "T9.02", "T9.03"],
    current_state:
      "Applied from execution/phase-02/Alignment-Delta.json with Alignment-Delta-Review.json corrections A–D; existing owners and source contracts preserved.",
    evidence_test:
      "Build a re-entry packet for a successor whose next act is 'declare a slice finished'. Fail if the packet does not carry SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self with its full text; or carries a shape its corpus file marks superseded; or the ids delivered are not recorded in the packet; or the delivery seam rewrote the author's bytes instead of appending.",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-10-ryan-the-system-delivers-the-shape-at-the-moment-not-the-agent-remembering.yaml",
    ],
  },
  {
    id: "IA-03",
    source: "shape-alignment",
    title: "Pairing should deliver usable threads automatically on all five devices",
    disposition: "consequential-choice",
    answered_by: ["K05", "K09", "T12.02", "T13.01"],
    current_state:
      "Applied from execution/phase-02/Alignment-Delta.json with Alignment-Delta-Review.json corrections A–D; admitted grant expiry and actual platform capabilities, no guessed operator prompts.",
    evidence_test:
      "Force-expire the Mac app's tower login and install a fresh phone build. Fail if: any step asks Ryan to type or paste a token; or the phone sits on 'Loading environments' after the agent reports it paired (the Oct 7 incident); or a denied OS permission is shown as granted; or an unauthorized device or a disallowed scope succeeds.",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-06-ryan-agents-handle-throughline-pairing-and-permissions-themselves.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-24-ryan-native-agent-hosts-are-credential-less-by-physical-boundary.yaml",
    ],
  },
  {
    id: "IA-04",
    source: "shape-alignment",
    title: "Preserving settings is not the same as propagating their intent",
    disposition: "consequential-choice",
    answered_by: ["K14", "T10.04", "T11.03"],
    current_state:
      "Applied from execution/phase-02/Alignment-Delta.json with Alignment-Delta-Review.json corrections A–D; existing owners and source contracts preserved.",
    evidence_test:
      "Change one curated setting on the Mac (for example the continue-threads-after-restart toggle). Fail if: the tower's or Raspberry Pi's effective setting differs after one propagation interval; or a release was needed; or a privilege or credential setting propagated; or the Pi model list differs from the Claude-plus-Codex union; or the change left no event on the record.",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-12-ryan-throughline-settings-made-on-the-mac-are-made-on-the-tower-without-asking-privileges-excluded.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-24-ryan-a-setting-that-differs-between-machines-resolves-by-its-intent-and-parity-outranks-size.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-16-ryan-pi-provider-lists-exactly-the-models-the-claude-and-codex-providers-list.yaml",
    ],
  },
  {
    id: "IA-09",
    source: "shape-alignment",
    title: "The inherited presence gate needs a health-recovery distinction",
    disposition: "consequential-choice",
    answered_by: ["K12", "T12.01", "T1.04"],
    current_state:
      "Applied from execution/phase-02/Alignment-Delta.json with Alignment-Delta-Review.json corrections A–D; routine-install presence versus health recovery remain distinct; Sep-25 source must be directly read before scope claim is accepted.",
    evidence_test:
      "With synthetic continuous input (presence reads OPERATOR_INPUT) and the tower server deliberately stalled, run the recovery route. Fail if it refuses on presence; or it loses a draft; or it writes no receipt. Then run an install quit under the same input: fail if it does not wait. Then read the Sep 25 order: fail the scope note if Ryan's words there govern more than the install quit.",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-05-ryan-never-prioritize-the-operator-at-the-keyboard-over-unsticking-the-system.yaml",
    ],
  },
  {
    id: "F01",
    source: "fidelity",
    title: "Match each decision to the words that actually support it",
    disposition: "bounded-repair",
    answered_by: ["K15", "D03", "D06", "D09", "D10", "D12", "D14"],
    current_state:
      "P2-02 builder/checker select exact admitted Ryan message ids for D03 and D12, with prior quote history. D06/D09/D10 remain approving-context with sender-unverified Oct-7 later sources; D14 remains approving-context naming adopted grammar standards. No unverified sender is promoted.",
    opus_repair:
      "Implemented message selectors in contracts-data.mts DECISION_SOURCES and build-spec/check-spec. Re-pick only D03/D12 from existing admitted Ryan messages; retain approving-context and unverified later-source distinctions for D06/D09/D10, and the adopted grammar-standard references for D14. Independent semantic review grades support.",
    evidence_test:
      "K15 test: an outside reader marks every decision quote supports or approving-context; zero wrong.",
    repair_history: [
      {
        at: "2026-10-09",
        previous: {
          id: "F01",
          source: "fidelity",
          title: "Match each decision to the words that actually support it",
          disposition: "bounded-repair",
          answered_by: ["K15", "D03", "D06", "D09", "D10", "D12", "D14"],
          current_state:
            "build-spec.mts still takes the first Ryan-speaker source of the named ledger item; X07 checks copied bytes only. 0.3.0 adds a source_role per decision and marks the six flagged decisions approving-context.",
          opus_repair:
            "For D03, D06, D09, D10, D12 and D14 read the thread dumps at the message ids the fidelity finding names and choose the clause that states the requirement or the approval; set quote_from_message to that message id in spec-data.mts DECISION_SOURCES; keep the prior excerpt in history; rebuild. No new words of Ryan's are written.",
          evidence_test:
            "K15 test: an outside reader marks every decision quote supports or approving-context; zero wrong.",
        },
      },
    ],
  },
  {
    id: "F02",
    source: "fidelity",
    title: "Account for every ledger requirement and important relationship",
    disposition: "already-resolved",
    answered_by: ["K16", "X11"],
    current_state:
      "Measured on 0.2.0: 131 of 199 items named by serves; 68 had no disposition. 0.3.0 authors a disposition for each of the 68 (LEDGER below), derives implemented for the rest, and X11 refuses a missing one.",
    evidence_test: "K16 test: remove one entry and the checker refuses.",
  },
  {
    id: "F03",
    source: "fidelity",
    title: "Specify five-device capabilities, not five release packages",
    disposition: "consequential-choice",
    answered_by: ["K09", "DEVICE_MATRIX", "T13.01"],
    current_state:
      "No device matrix existed; T10.01 named an iOS picker and T10.04 web and desktop only. 0.3.0 adds the matrix with roles, owners and cold tests; Android is required in every applicable row.",
  },
  {
    id: "F04",
    source: "fidelity",
    title: "Restore user-facing obligations lost in abbreviated task descriptions",
    disposition: "consequential-choice",
    answered_by: ["K14", "T10.04", "T10.02"],
    current_state:
      "T10.04 said voice-to-text through Message Optimizer and nothing of the full process, the central log, the model-or-Off preference, selected-text versus full-draft, original and undo; Return-to-send, inline paste, side chat, vault viewer copy and turn budget had no task behavior. K14 carries each; T10.04 and T10.02 inherit it; the optional voice app, iPhone dictation and Pi image extension stay optional.",
  },
  {
    id: "F05",
    source: "fidelity",
    title: "Preserve actual provider binding and recovery guarantees",
    disposition: "consequential-choice",
    answered_by: ["K01", "K03", "T3.02", "T8.01", "T11.01", "T11.02"],
    current_state:
      "T3.02 described finished messages and T11.01 one step per completed Pi turn. K01 states per-action admission, durable content, provenance and crash recovery; K03 states the per-provider enforcement matrix; the provider tasks inherit both.",
  },
  {
    id: "F06",
    source: "fidelity",
    title: "Resolve exploration, target admission and independent acceptance",
    disposition: "consequential-choice",
    answered_by: ["K08", "T9.01", "T9.02", "T9.03"],
    current_state:
      "T9.01 said every thread binds to a target; T9.02 could decline to save one; no acceptance owner for agent-only threads; the FOLD decision assumed no record-free session. K08 states the exploring state, the admission order, revisions, correction tools and the named non-builder acceptance owner; the check-first scope is decided.",
  },
  {
    id: "F07",
    source: "fidelity",
    title: "Reconcile conflicting decision generations",
    disposition: "consequential-choice",
    answered_by: ["K15", "K07", "K04", "T3.01", "T7.02", "D12", "D17"],
    current_state:
      "D12 now calls 0.80 an unevaluated parameter (K07); T3.01 states that the admission decorator lives in the fork namespace and only the mount lines are upstream edits counted by the manifest; T7.02 states that one endpoint per account is Fable's mechanism under the open ledger item; NG-175 is answered by K04; NG-098 is read as rewind and compaction coexisting (K06). Each superseded wording stays in the ledger's history; the ledger text itself changes only through a ledger task with authority.",
  },
  {
    id: "F08",
    source: "fidelity",
    title: "Make whole-design completion require the whole design",
    disposition: "already-resolved",
    overlaps: ["A15"],
    answered_by: ["K10", "ACCEPTANCE", "X14"],
    current_state:
      "T13.01 depended on two tasks and the graph drew task edges only. 0.3.0 adds the acceptance node over every detailed task, every slice and every required device cell, X14 checks the combined graph and the map draws slice gates and the node.",
    evidence_test:
      "K10 test: hold one required task incomplete; acceptance refuses, a slice release passes.",
  },
  {
    id: "F09",
    source: "fidelity",
    title: "Repair misleading Raspberry Pi relationships in the map",
    disposition: "bounded-repair",
    answered_by: ["K16"],
    current_state:
      "P2-02 new ledger refresh re-points the two Raspberry Pi joins to NG-119 with source-message evidence and prior edge history; independent source/map acceptance remains required.",
    opus_repair:
      "Implemented as the bounded P2-02 source repair; independent checker consumes the saved command outputs and the source diff, not the builder’s confidence.",
    repair_history: [
      {
        at: "2026-10-09",
        previous: {
          id: "F09",
          source: "fidelity",
          title: "Repair misleading Raspberry Pi relationships in the map",
          disposition: "bounded-repair",
          answered_by: ["K16"],
          current_state:
            "The two joins NG-142 enables NG-104 and NG-169 part-of NG-104 still carry the old all-device parity meaning after NG-104 narrowed to phone parity. The ledger is not refreshed by this pass (Ryan's kickoff).",
          opus_repair:
            "In the ledger builder's refresh data (fable-refresh-2026-10-07.mts pattern), re-point NG-142 to enable NG-119 and NG-169 to be part-of NG-119, each with the reason and the Thread-Dump-07de2352 message as evidence, rebuild the ledger and map, and re-run the ledger gate; ids stay.",
        },
      },
    ],
  },
  {
    id: "F10",
    source: "fidelity",
    title: "Refresh stale glossary meanings",
    disposition: "bounded-repair",
    answered_by: ["K15", "K04", "K08", "K07"],
    current_state:
      "P2-02 preserves dated version-1 glossary meanings/sources and adds version-2 meanings grounded in K08/K04/K07; source-generation snapshots preserve provenance across later selector edits.",
    opus_repair:
      "Implemented as the bounded P2-02 source repair; independent checker consumes the saved command outputs and the source diff, not the builder’s confidence.",
    repair_history: [
      {
        at: "2026-10-09",
        previous: {
          id: "F10",
          source: "fidelity",
          title: "Refresh stale glossary meanings",
          disposition: "bounded-repair",
          answered_by: ["K15", "K04", "K08", "K07"],
          current_state:
            "The ledger glossary still defines admit (a target) without the JEV-before-save step, agent account as twr, and judgment as outside JEV. The spec contracts carry the current meanings.",
          opus_repair:
            "Version the three glossary terms in the ledger refresh data with the dated old sense kept and the current sense citing K08, K04 and K07; rebuild the ledger; re-run its gate.",
        },
      },
    ],
  },
  {
    id: "F11",
    source: "fidelity",
    title: "Restore complete governing quotations",
    disposition: "bounded-repair",
    answered_by: ["K15"],
    current_state:
      "P2-02 restores complete governing paragraphs for NG-052/NG-013/NG-014 and saves their prior excerpts; raw text occurrence is not a semantic acceptance verdict.",
    opus_repair:
      "Implemented as the bounded P2-02 source repair; independent checker consumes the saved command outputs and the source diff, not the builder’s confidence.",
    repair_history: [
      {
        at: "2026-10-09",
        previous: {
          id: "F11",
          source: "fidelity",
          title: "Restore complete governing quotations",
          disposition: "bounded-repair",
          answered_by: ["K15"],
          current_state:
            "NG-052's displayed quote drops its negation; two other excerpts end mid-clause. Substring validation passes them.",
          opus_repair:
            "Replace the three excerpts in the ledger refresh data with the complete governing clauses from Thread-Dump-0baaef5f and Thread-Dump-b29affbb at the message ids the finding names; keep the prior excerpts in the revision block; rebuild.",
        },
      },
    ],
  },
  {
    id: "F12",
    source: "fidelity",
    title: "Separate required cross-device communication from optional transport choices",
    disposition: "consequential-choice",
    answered_by: ["K05", "T7.05", "T12.02"],
    current_state:
      "T7.05 said explore only and T12.02 promised pairing without Tailscale with no Cloudflare path. K05 makes the outcome required, keeps the transport a choice, preserves the Cloudflare route and states pairing-only versus functional fallback; T7.05 and T12.02 are rewritten.",
  },
  {
    id: "F13",
    source: "fidelity",
    title: "Separate Android readiness evidence into actual proof levels",
    disposition: "already-resolved",
    overlaps: ["A16"],
    answered_by: ["K09", "DEVICE_MATRIX"],
    current_state:
      "K09 names the six evidence levels with dated receipts; the Oct 7 Google sign-in receipt counts for authentication only; Android stays required.",
    evidence_test: "six receipts, one per level, each with commit, version, device and time.",
  },
  {
    id: "A01",
    source: "architecture",
    title: "Safe repository-move admission",
    disposition: "already-resolved",
    answered_by: ["K17", "P0"],
    current_state:
      "Rechecked on disk Oct 8, 2026: the precondition reads row.outcome of the highest rewind-live-proof attempt and requires Release-Closure.md; the round-2 judge confirmed it exits 0 today. Still owed: the abort branch binds to the exact run, discovery errors fail, and exclusion lives in the admission record (K17) rather than a process scan; carried in the judge-round-2 repair.",
  },
  {
    id: "A02",
    source: "architecture",
    title: "Validators that reject invalid plans",
    disposition: "already-resolved",
    answered_by: ["X03", "X12", "X13", "X14", "X15", "X16", "test-check-spec.mts"],
    current_state:
      "Audit copies with a slice cycle, an invented task state and an extra upstream edit passed 0.2.0 green. 0.3.0 adds closed enums and unique ids (X13), the combined slice-task-precondition graph (X03, X14), a non-increase check against an admitted baseline file (X15), rendered-generation binding (X16) and a negative-fixture test that must fail on the three mutations.",
    evidence_test:
      "node test-check-spec.mts: the three preserved mutations fail with named reasons, the valid spec passes.",
  },
  {
    id: "A03",
    source: "architecture",
    title: "The authoritative event and external-action contract",
    disposition: "consequential-choice",
    answered_by: ["K01", "T3.01", "T3.02", "T3.03", "T4.01"],
    current_state:
      "No contract existed beyond the ledger's statements. K01 is the contract; the slice-3 tasks inherit it and carry its kill-at-every-boundary test.",
  },
  {
    id: "A04",
    source: "architecture",
    title: "Shared storage without conflating lifetimes",
    disposition: "consequential-choice",
    answered_by: ["K02", "D17", "T3.02", "T7.03", "T9.01", "T10.03"],
    current_state:
      "One task per thread was implied. K02 chooses request-scoped workflows under a conversation identity, five distinct states, durable waits, and pins Absurd 0.5.0 with a migration task.",
  },
  {
    id: "A05",
    source: "architecture",
    title: "Prove each provider's enforcement capabilities",
    disposition: "evidence-needed",
    answered_by: ["K03", "T8.01", "T11.01", "T11.02"],
    current_state:
      "The spec claimed binding through approval handlers and mod hooks. K03 makes the matrix the deliverable; the counts are the evidence. G6 (Oct 9, 2026) supplied source and installed-tooling capability and custody metadata as design evidence only; every count stays unmeasured and this item stays evidence-needed until pinned provider, host and profile trials run.",
    evidence_test:
      "K03 test under the real launch policy on all three providers; every matrix cell is a measured count.",
  },
  {
    id: "A06",
    source: "architecture",
    title: "Durable agent identity versus temporary accounts and processes",
    disposition: "consequential-choice",
    answered_by: ["K04", "T5.01", "T5.02", "T6.01", "T6.02", "T6.03"],
    current_state:
      "Identity and account lifetime were conflated. K04 binds the public id to an execution generation, states cleanup, revocation and resume, and the reachable broker socket under the isolated profile.",
  },
  {
    id: "A07",
    source: "architecture",
    title: "Connectivity without a second execution authority",
    disposition: "consequential-choice",
    answered_by: ["K05", "T4.01", "T4.02", "T7.05", "T12.02"],
    current_state:
      "Stated in K05: three states, no Mac scheduler or database, lease-loss behavior, the Cloudflare route to the same service.",
  },
  {
    id: "A08",
    source: "architecture",
    title: "Consistent recovery and rewind boundaries",
    disposition: "consequential-choice",
    answered_by: ["K06", "T8.02", "T10.01", "T5.01"],
    current_state:
      "The FOLD decision had code releasing and JEV bouncing; K06 adds the generation cut, the compare-and-release and the pending-rewind state.",
  },
  {
    id: "A09",
    source: "architecture",
    title: "One reusable JEV integration",
    disposition: "consequential-choice",
    answered_by: ["K07", "D12", "T9.02"],
    current_state:
      "D12 called 0.80 Fable's parameter with a rollback. K07 makes it unevaluated until the calibration test and separates classification from authority.",
    evidence_test: "K07 calibration test on a labelled corpus.",
  },
  {
    id: "A10",
    source: "architecture",
    title: "Measure upstream maintenance beyond file count",
    disposition: "consequential-choice",
    answered_by: ["K11", "T2.01", "T2.03"],
    current_state:
      "The seam measured file count only. K11 binds the manifest to SHAs and diff coverage, adds private-symbol and schema measures and the adopt/retain/replace/defer table; the shrinking count stays as Ryan's control.",
  },
  {
    id: "A11",
    source: "architecture",
    title: "Android and mixed-version compatibility belong in early contracts",
    disposition: "consequential-choice",
    answered_by: ["K09", "T13.01", "T3.02"],
    current_state:
      "Android sat in the last task. K09 puts negotiation, minimum client, tolerant decoding, cursor replay and migrations before substrate work and tracks Android evidence at six levels.",
  },
  {
    id: "A12",
    source: "architecture",
    title: "Recover interrupted releases from actual action state",
    disposition: "consequential-choice",
    answered_by: ["K12", "T1.04", "T13.01"],
    current_state:
      "The pipeline refused replays and start markers were moved by hand on Oct 7. K12 gives every step an operation id, a lease, a retry class and digests; slice 1's T1.04 inherits it for the two new steps and the next release tool version carries it for the rest.",
  },
  {
    id: "A13",
    source: "architecture",
    title: "Publish document copies consistently and label their revisions honestly",
    disposition: "consequential-choice",
    answered_by: ["K13", "T1.06", "T1.10"],
    current_state:
      "The round-2 judge found the pending folder moved away with its parent and the label mixed source and release. K13 fixes the transaction shape, the two labels, frontmatter merging, link rewriting, the allowlist and the relocation index; the exact code change is in the judge-round-2 repair.",
  },
  {
    id: "A14",
    source: "architecture",
    title: "Keep UI, terminal and voice features inside the same authority boundaries",
    disposition: "consequential-choice",
    answered_by: ["K14", "T9.03", "T10.02", "T10.04"],
    current_state: "Stated in K14; the slice-10 tasks inherit it.",
  },
  {
    id: "A15",
    source: "architecture-addenda",
    title: "Final-release dependency gap demonstrated",
    disposition: "already-resolved",
    overlaps: ["F08"],
    answered_by: ["K10", "ACCEPTANCE", "X14"],
    current_state:
      "Resolved once with F08: the acceptance node, not T13.01, is the whole-design done state.",
  },
  {
    id: "A16",
    source: "architecture-addenda",
    title: "Android authentication is narrower than app acceptance",
    disposition: "already-resolved",
    overlaps: ["F13"],
    answered_by: ["K09"],
    current_state:
      "The six-level evidence rule records the sign-in receipt as authentication only.",
  },
  {
    id: "A17",
    source: "architecture-addenda",
    title: "Use the current JEV recipe repertoire",
    disposition: "already-resolved",
    answered_by: ["K07"],
    current_state:
      "K07 names the jev-experiments 0.9.0 repertoire as the source of typed patterns and distinguishes source from installed (0.8.1 installed on Codex at the audit).",
  },
  {
    id: "A18",
    source: "architecture-addenda",
    title: "Preserve existing capability tests while refreshing upstream reconciliation",
    disposition: "consequential-choice",
    answered_by: ["K11", "T2.01", "T2.03"],
    current_state:
      "K11 keeps the rewind capability manifest, refreshes seam identities before any sync, and forbids take-upstream for a path under a capability manifest.",
  },
  {
    id: "J2",
    source: "judge-round-2",
    title:
      "The slice-1 move-to-release ordering, artifact and publication contracts, acceptance checks bound to real source, remote creation bindings and residue-safe cleanup",
    disposition: "bounded-repair",
    answered_by: [
      "K17",
      "K12",
      "K13",
      "T1.03",
      "T1.04",
      "T1.05",
      "T1.06",
      "T1.07",
      "T1.09",
      "T1.10",
      "S1-F01",
    ],
    current_state:
      "P2-02 repairs every section-7 row and sections 2–4 under K12/K13/K17: real archive schema/fingerprints, publication/containment/stage contracts, exact identity/consumer checks and disposable counterexample fixtures. Future product/move/release acceptance is not performed by these source repairs.",
    opus_repair:
      "Implemented as the bounded P2-02 source repair; independent checker consumes the saved command outputs and the source diff, not the builder’s confidence.",
    evidence_test:
      "the third-round judge re-runs check-spec.mts, test-check-spec.mts and the slice-1 checks and rules on the seven sections again.",
    repair_history: [
      {
        at: "2026-10-09",
        previous: {
          id: "J2",
          source: "judge-round-2",
          title:
            "The slice-1 move-to-release ordering, artifact and publication contracts, acceptance checks bound to real source, remote creation bindings and residue-safe cleanup",
          disposition: "bounded-repair",
          answered_by: [
            "K17",
            "K12",
            "K13",
            "T1.03",
            "T1.04",
            "T1.05",
            "T1.06",
            "T1.07",
            "T1.09",
            "T1.10",
          ],
          current_state:
            "Verdict FAIL on 0.2.0 (sections 1 to 4, 6 and 7; section 5 PASS). The contracts the judge asked the author to settle are K17 (three admission states, stage-scoped checks, records versus build roots, closure last), K13 (publication transaction) and K12 (operation identity). The remaining items are mechanical.",
          opus_repair:
            "Under K17, K13 and K12, apply every row of the verdict's section 7 table and the section 2 to 4 findings to spec-data.mts fragment B and the checks file: Step records for vault-clean and publish-docs with their consumers; validatePipeline treating records and build roots as distinct classes with nearest-existing-ancestor resolution; relocated producers for the tower and Raspberry Pi archives with build-root parameters; retained helpers distinguished from the moved checkout; the archive ledger consumed in its real object-with-moves format; moved-and-preserved separated from archived-and-removed; sibling staging with restore-on-failure; a correct recursive matcher with fixtures; stage-scoped done checks for T1.03; bottom-up empty-directory removal in T1.07; index-entry equality, unborn HEAD and empty-selection fixtures in T1.09; tag-object identity and bound heads in S1-C01, C03 and C04; exact executable records and a real rehearsal in S1-C05; the exact design-file set in S1-C10; runner evidence in S1-C11; payload hashes in S1-C12; release identity binding in S1-C13; a server-bound probe in S1-C14. Then a third judge round rules.",
          evidence_test:
            "the third-round judge re-runs check-spec.mts, test-check-spec.mts and the slice-1 checks and rules on the seven sections again.",
        },
      },
    ],
  },
  {
    id: "IA-01",
    source: "shape-alignment",
    title: "The repository rename is assigned to Ryan without governing authority",
    disposition: "already-resolved",
    answered_by: ["R02"],
    current_state:
      "R02 carries ryan_required false and the note that no Ryan quote reserves or orders it; D01 no longer says his account.",
  },
  {
    id: "IA-07",
    source: "shape-alignment",
    title: "The Mac database credential boundary needs a concrete proof",
    disposition: "evidence-needed",
    answered_by: ["K05", "T4.01"],
    current_state: "D04 stated the keychain entry with an app-only access list; K05 adds the test.",
    evidence_test:
      "a Mac-local agent process attempts to read the keychain entry and is refused; the app reads it.",
  },
  {
    id: "IA-08",
    source: "shape-alignment",
    title: "Agent-only target acceptance must not quietly default to Ryan",
    disposition: "consequential-choice",
    answered_by: ["K08"],
    current_state:
      "K08 names the acceptance owner at dispatch, else the manager's judge, never the builder and never Ryan by default.",
  },
  {
    id: "IA-10",
    source: "shape-alignment",
    title: "Voice parity must preserve the full optimizer, not just a text rewrite",
    disposition: "consequential-choice",
    answered_by: ["K14"],
    current_state: "Resolved with F04.",
  },
  {
    id: "IA-11",
    source: "shape-alignment",
    title: "Measure upstream maintenance, not only the number of touched files",
    disposition: "consequential-choice",
    answered_by: ["K11"],
    current_state: "Resolved with A10.",
  },
];

// ---------- the disposition of every ledger item the task graph does not name ----------
const EXT_BROKER =
  "external-capability: the tower access broker and service broker, owned by the admin-capability-broker component; this design consumes them";
const BROKER_TEST =
  "one real consuming turn from a ThroughLine-launched seat on the tower reaches a model through the access broker with no credential in the seat (T11.03 done test)";
export const LEDGER: LedgerDisposition[] = [
  {
    id: "NG-141",
    kind: "external-capability",
    by: ["T11.03", "T6.02"],
    note: "credential-free headroom observer owned by admin-capability-broker; every currently configured identity is retained",
    consumption_test:
      "A launched seat reads every currently configured broker identity’s headroom through the owning observer contract with reset/freshness/unknown states and no credential in the seat; controlled exhaustion/recovery traverses the real consumer, never subscription depletion",
  },
  { id: "NG-114", kind: "implemented", by: ["T10.04", "T3.02"], note: "alignment integration" },
  { id: "NG-129", kind: "implemented", by: ["T12.02", "T13.01"], note: "alignment integration" },
  {
    id: "NG-131",
    kind: "implemented",
    by: ["T4.03"],
    note: "T4.03 repurposes habitat as a second transition observer; laptop-closed loss and independent notification are Raspberry Pi-owned prerequisites; no Mac Health Hub acceptance",
  },
  {
    id: "NG-001",
    kind: "deferred-exploration",
    by: ["K14", "T10.04"],
    note: "phone voice fallback and settings-save behavior; K14 fixes the raw-text and status obligations, the fallback choice is explored in slice 10",
  },
  {
    id: "NG-002",
    kind: "inherited-constraint",
    by: ["K01", "slice-3"],
    note: "the substrate is the Postgres database and its execution protocol; K01 is written over it",
  },
  {
    id: "NG-004",
    kind: "inherited-constraint",
    by: ["K01", "K02"],
    note: "ceremony, bookkeeping, state and memory are records on the substrate; no second journal (K06 retires the mod-local one)",
  },
  {
    id: "NG-005",
    kind: "inherited-constraint",
    by: ["K01", "K02", "D17"],
    note: "stock Absurd used as designed, pinned to 0.5.0 (K02)",
  },
  {
    id: "NG-042",
    kind: "inherited-constraint",
    by: ["slice-8"],
    note: "everything ruled out for Claude before mods is reconsidered inside slice 8",
  },
  {
    id: "NG-051",
    kind: "implemented",
    by: ["K07", "T8.01"],
    note: "JEV in the mod through the one condition port",
  },
  {
    id: "NG-052",
    kind: "implemented",
    by: ["T6.02", "T8.01"],
    note: "the launcher registers mods and skills for the agent; Ryan is never the registrar",
  },
  {
    id: "NG-063",
    kind: "external-capability",
    by: ["T11.03", "K03"],
    note: EXT_BROKER,
    consumption_test: BROKER_TEST,
  },
  {
    id: "NG-064",
    kind: "external-capability",
    by: ["T10.04"],
    note: EXT_BROKER + " (Message Optimizer is its service)",
    consumption_test:
      "a voice draft from the phone is optimized by the tower service and logged in its central log",
  },
  {
    id: "NG-065",
    kind: "external-capability",
    by: ["D14"],
    note: "broker folders follow the folder grammar; owned by the broker component",
    consumption_test: "the folder grammar checker, when built, passes the broker tree",
  },
  {
    id: "NG-071",
    kind: "implemented",
    by: ["K14", "T10.04"],
    note: "the full original optimizer process on the tower is a K14 obligation",
  },
  {
    id: "NG-082",
    kind: "implemented",
    by: ["K08"],
    note: "acceptance in threads Ryan never enters: decided in K08",
  },
  {
    id: "NG-099",
    kind: "implemented",
    by: ["K06", "T10.01"],
    note: "a rewind accepted while the provider is in error is shown as pending",
  },
  {
    id: "NG-102",
    kind: "deferred-exploration",
    by: ["T10.02"],
    note: "how families are found and shown is chosen when slice 10 is detailed; lineage columns are fixed by K04",
  },
  {
    id: "NG-134",
    kind: "superseded",
    by: ["D04", "K01"],
    note: "a per-seat pi-durable store is a second record; superseded by one record (Ryan: every message on the Absurd substrate)",
  },
  {
    id: "NG-135",
    kind: "deferred-exploration",
    by: [],
    note: "Pi's default system prompt belongs to the Pi harness, outside phase one",
  },
  {
    id: "NG-136",
    kind: "deferred-exploration",
    by: ["K01"],
    note: "other work on the rails is admitted through the same contract when it comes",
  },
  {
    id: "NG-140",
    kind: "external-capability",
    by: ["T11.03", "T12.02"],
    note: "protected broker-held pairing grant; not a provider identity or a frozen account-count invariant",
    consumption_test:
      "An unpaired or grant-expired client loads its intended threads and completes one permitted exchange through the broker-held typed pairing grant, without an agent-readable credential or Ryan typing a token; expiry is read from that admitted grant",
  },
  {
    id: "NG-143",
    kind: "implemented",
    by: ["K05", "T12.02"],
    note: "the tunnel topology is the preserved no-Tailscale route",
  },
  {
    id: "NG-144",
    kind: "implemented",
    by: ["K03", "K05"],
    note: "model traffic and starting a turn are different capabilities: separate rows in K03 and separate states in K05",
  },
  {
    id: "NG-145",
    kind: "external-capability",
    by: ["T11.03"],
    note: "external-capability: the tower access broker and service broker, owned by the admin-capability-broker component; this design consumes them",
    consumption_test: "a seat keeps working when the primary login is at its limit",
  },
  {
    id: "NG-146",
    kind: "implemented",
    by: ["T11.03"],
    note: "real consuming turns are the broker consumption test",
  },
  {
    id: "NG-147",
    kind: "external-capability",
    by: ["T11.03"],
    note: EXT_BROKER,
    consumption_test: BROKER_TEST,
  },
  {
    id: "NG-148",
    kind: "external-capability",
    by: ["T11.03"],
    note: EXT_BROKER,
    consumption_test: BROKER_TEST,
  },
  {
    id: "NG-149",
    kind: "inherited-constraint",
    by: ["R03", "T6.01"],
    note: "privileged tower execution runs reviewed root-owned bytes; the supervisor install follows it",
  },
  {
    id: "NG-150",
    kind: "deferred-exploration",
    by: ["R03"],
    note: "a governed tower installer stays an exploration; Ryan performs sudo installs for now",
  },
  {
    id: "NG-151",
    kind: "external-capability",
    by: [],
    note: "Ship Warden provider-write and root-check paths are the warden's",
    consumption_test: "the next warden ship of the release tool passes its gates",
  },
  {
    id: "NG-152",
    kind: "external-capability",
    by: ["K05"],
    note: "broker cutover boundaries are the broker's; K05 states which clients may execute",
    consumption_test: BROKER_TEST,
  },
  {
    id: "NG-153",
    kind: "external-capability",
    by: ["T11.03"],
    note: EXT_BROKER,
    consumption_test: BROKER_TEST,
  },
  {
    id: "NG-154",
    kind: "external-capability",
    by: ["T11.03"],
    note: EXT_BROKER,
    consumption_test: "the broker metadata is readable by a seat and carries no secret",
  },
  {
    id: "NG-155",
    kind: "external-capability",
    by: ["T11.03"],
    note: EXT_BROKER,
    consumption_test: BROKER_TEST,
  },
  {
    id: "NG-156",
    kind: "external-capability",
    by: [],
    note: EXT_BROKER,
    consumption_test: "a capability install with a colliding name is refused",
  },
  {
    id: "NG-157",
    kind: "external-capability",
    by: ["T12.01"],
    note: EXT_BROKER + "; its health is one of the watched services",
    consumption_test: "the service health row appears on the surface T12.01 names",
  },
  {
    id: "NG-158",
    kind: "deferred-exploration",
    by: [],
    note: "per-service settings access in the folder design; broker component",
  },
  {
    id: "NG-159",
    kind: "deferred-exploration",
    by: [],
    note: "service menus for delegated work; broker component",
  },
  {
    id: "NG-160",
    kind: "external-capability",
    by: ["T10.04"],
    note: "the duplicate optimizer retires only with the service consumer preserved",
    consumption_test:
      "the phone and desktop voice path reaches the tower service after the duplicate is gone",
  },
  {
    id: "NG-161",
    kind: "inherited-constraint",
    by: ["R03"],
    note: "the exact tower install is checked before its privileged step",
  },
  {
    id: "NG-162",
    kind: "external-capability",
    by: [],
    note: "broker cutover drains in-flight work",
    consumption_test: "a turn in flight across the cutover completes or is recorded unknown (K01)",
  },
  {
    id: "NG-163",
    kind: "deferred-exploration",
    by: [],
    note: "staged-file replacement versus moving installed broker bytes; broker component",
  },
  {
    id: "NG-164",
    kind: "deferred-exploration",
    by: [],
    note: "the account-rename simplification; broker component",
  },
  {
    id: "NG-165",
    kind: "deferred-exploration",
    by: [],
    note: "why the account rename needs each step; broker component",
  },
  {
    id: "NG-166",
    kind: "implemented",
    by: ["K05", "T12.01", "T11.03"],
    note: "authentication reachability and available usage are different checks; K05 states the three states and T12.01 watches both",
  },
  {
    id: "NG-167",
    kind: "external-capability",
    by: ["T11.03", "T6.02"],
    note: "the account split works for authenticated agents and service consumers; consumed by the launcher and the model route",
    consumption_test: BROKER_TEST,
  },
  {
    id: "NG-168",
    kind: "external-capability",
    by: [],
    note: "reinstallation cannot restore stale broker names",
    consumption_test: "a reinstall after the rename finds no old unit name",
  },
  {
    id: "NG-169",
    kind: "external-capability",
    by: ["K09"],
    note: "centralized consumers proven before the Raspberry Pi duplicates retire; the device matrix carries the Raspberry Pi rows (its ledger join to NG-104 is repaired by F09)",
    consumption_test: "the Raspberry Pi execution-host rows of the matrix pass cold",
  },
  {
    id: "NG-170",
    kind: "implemented",
    by: ["K04", "K05"],
    note: "remote consuming turns without agent credentials: the launcher-bound identity and the broker socket",
  },
  {
    id: "NG-171",
    kind: "external-capability",
    by: [],
    note: "the broker topography picture belongs to the broker component",
    consumption_test: "the picture exists and names every account and boundary K04 and K05 rely on",
  },
  {
    id: "NG-172",
    kind: "deferred-exploration",
    by: ["D14"],
    note: "broker command placement follows the command grammar when proposed",
  },
  {
    id: "NG-173",
    kind: "inherited-constraint",
    by: ["T11.03", "T11.01"],
    note: "model-request bytes are preserved; the Pi provider route through the broker is accepted",
  },
  {
    id: "NG-174",
    kind: "deferred-exploration",
    by: ["K01"],
    note: "recovery across a broker restart is the unknown-effect state of K01 applied to the broker",
  },
  {
    id: "NG-175",
    kind: "implemented",
    by: ["K04"],
    note: "account identity authenticated against the launch record: the execution generation",
  },
  {
    id: "NG-176",
    kind: "deferred-exploration",
    by: ["K07"],
    note: "JEV launch-record authentication stays an option; K04 authenticates by code",
  },
  {
    id: "NG-177",
    kind: "external-capability",
    by: [],
    note: "caller-side broker workarounds removed after the real fix",
    consumption_test: "no workaround environment variable remains in a launched seat",
  },
  {
    id: "NG-178",
    kind: "superseded",
    by: ["D01", "K13"],
    note: "a temporary read-only thread page outside the fork is superseded by the own repository and the published copies",
  },
  {
    id: "NG-179",
    kind: "deferred-exploration",
    by: ["T10.02"],
    note: "a fluid text representation of thread work is explored in slice 10",
  },
  {
    id: "NG-181",
    kind: "implemented",
    by: ["K14", "T10.02"],
    note: "one shared read model with platform-specific presentation",
  },
  {
    id: "NG-182",
    kind: "implemented",
    by: ["K09"],
    note: "native-device verification with separate proof levels",
  },
  {
    id: "NG-183",
    kind: "implemented",
    by: ["T10.04", "T11.03"],
    note: "rate-limit refusal is a wait row resumed by the owning observer reset event, never operator resubmission; controlled provider/observer fault test, no subscription depletion",
  },
  {
    id: "NG-184",
    kind: "deferred-exploration",
    by: ["K14"],
    note: "an own voice application stays optional",
  },
  {
    id: "NG-185",
    kind: "deferred-exploration",
    by: ["K14"],
    note: "system-wide iPhone dictation stays optional",
  },
  {
    id: "NG-186",
    kind: "implemented",
    by: ["K14"],
    note: "the original phone voice transcript is preserved and undoable",
  },
  {
    id: "NG-188",
    kind: "external-capability",
    by: [],
    note: "the shared skill-upload refusal and ahead-of-time teaching contract stays with its owner outside this product slice",
    consumption_test: "the refusal still fires on the next upload attempt after slice 1",
  },
  {
    id: "NG-189",
    kind: "external-capability",
    by: ["T11.03"],
    note: "subscription-backed image generation through the access broker",
    consumption_test:
      "one image request from a launched seat succeeds through the broker with no key in the seat",
  },
  {
    id: "NG-190",
    kind: "implemented",
    by: ["T11.03"],
    note: "image access through the governed launchers and ThroughLine is a model route in K03",
  },
  {
    id: "NG-191",
    kind: "deferred-exploration",
    by: ["T11.01"],
    note: "a Pi image extension stays optional",
  },
  {
    id: "NG-193",
    kind: "implemented",
    by: ["K14", "T10.04"],
    note: "the inline-paste control is one of the carried app features",
  },
  {
    id: "NG-194",
    kind: "deferred-exploration",
    by: ["K05"],
    note: "request-size refusals versus broker outages are distinguished in the K05 states when slice 12 is detailed",
  },
];

// ---------- the five-device capability matrix ----------
const X = (
  device: DeviceCell["device"],
  role: DeviceCell["role"],
  owner: string,
  test: string,
): DeviceCell => ({ device, role, state: "required", owner, test });
const NA = (
  device: DeviceCell["device"],
  role: DeviceCell["role"],
  reason: string,
): DeviceCell => ({ device, role, state: "not-applicable", reason });
export const DEVICE_ROLES = {
  mac: "both",
  twr: "execution-host",
  rpi: "execution-host",
  ios: "control-client",
  android: "control-client",
} as const;
export const DEVICE_MATRIX: DeviceRow[] = [
  {
    key: "version",
    capability: "version: the installed build reads back the release and its commit",
    serves: ["NG-119"],
    steps: "open the settings screen or query the server's loopback address; screenshot",
    expect: "the release and commit of the candidate",
    evidence: "<evidence_root>/T13.04/version-<device>.png",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T13.04",
        proof: "host",
        test: "settings screen in the installed app",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T13.04",
        proof: "host",
        test: "server reports the release on its loopback address",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T13.04",
        proof: "host",
        test: "server reports the release on port 13774",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T13.04",
        proof: "physical",
        test: "settings screen on the iPhone via Mirroring",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T13.04",
        proof: "physical",
        test: "the installed app on the physical phone sends its release and commit in its hello (T3.05), recorded on the tower; the screenshot half waits for the debugging authorization",
        witness: "app-reported",
        role: "control-client",
      },
    ],
  },
  {
    key: "exec-claude",
    capability: "exec-claude: a Claude seat runs bound to the record (K01, K03)",
    serves: ["NG-029", "NG-035"],
    steps: "start one Claude turn with one tool call; read the admission rows and effect attempts",
    expect:
      "every call admitted or refused with an engine-signed command id; recorded model matches the picker",
    evidence: "<evidence_root>/T8.01/k03-claude-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T8.01",
        proof: "host",
        test: "one turn on the Mac",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T8.01",
        proof: "host",
        test: "one turn under a dynamic account",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T8.01",
        proof: "host",
        test: "one turn under a dynamic account on the Raspberry Pi under its supervisor, after that host's own T6.01 and T6.02 receipts, with this provider's K03 row measured on the Raspberry Pi",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "not-applicable",
        reason: "a phone starts turns; it never executes a provider",
        role: "control-client",
      },
      {
        device: "android",
        state: "not-applicable",
        reason: "a phone starts turns; it never executes a provider",
        role: "control-client",
      },
    ],
  },
  {
    key: "exec-codex",
    capability: "exec-codex: a Codex seat runs bound to the record through its approvals (K03)",
    serves: ["NG-031", "NG-038"],
    steps: "start one Codex turn with one command and one file change",
    expect: "approvals routed to admission; refused approval did not run; round-trip cost recorded",
    evidence: "<evidence_root>/T11.02/k03-codex-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T11.02",
        proof: "host",
        test: "one turn on the Mac",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T11.02",
        proof: "host",
        test: "one turn under a dynamic account",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T11.02",
        proof: "host",
        test: "one turn under a dynamic account on the Raspberry Pi under its supervisor, after that host's own T6.01 and T6.02 receipts, with this provider's K03 row measured on the Raspberry Pi",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "not-applicable",
        reason: "a phone never executes a provider",
        role: "control-client",
      },
      {
        device: "android",
        state: "not-applicable",
        reason: "a phone never executes a provider",
        role: "control-client",
      },
    ],
  },
  {
    key: "exec-pi",
    capability: "exec-pi: a Pi seat runs bound to the record with a stable cache key (K02, K03)",
    serves: ["NG-032", "NG-037", "NG-132"],
    steps: "two requests in one Pi conversation",
    expect:
      "one short workflow per request; same prompt_cache_key on every call; measured cached input reported",
    evidence: "<evidence_root>/T11.01/pi-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T11.01",
        proof: "host",
        test: "two requests on the Mac",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T11.01",
        proof: "host",
        test: "two requests and one worker kill",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T11.01",
        proof: "host",
        test: "two requests on the Raspberry Pi under its supervisor, after that host's own T6.01 and T6.02 receipts, with this provider's K03 row measured on the Raspberry Pi",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "not-applicable",
        reason: "a phone never executes a provider",
        role: "control-client",
      },
      {
        device: "android",
        state: "not-applicable",
        reason: "a phone never executes a provider",
        role: "control-client",
      },
    ],
  },
  {
    key: "identity",
    unchanged_from_spec: true,
    owned_by: "slices 4-7 preparer",
    capability: "identity: the launcher binds the public id to an execution generation (K04)",
    serves: ["NG-061", "NG-062"],
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T6.03",
        proof: "host",
        test: "the adapter binds the app identity; a replayed registration is refused",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T6.02",
        proof: "host",
        test: "K04 test",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T6.02",
        proof: "host",
        test: "the Raspberry Pi's own T6.01 and T6.02 receipts, fired by a non-builder as rpi under the Raspberry Pi supervisor",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "not-applicable",
        reason: "the phone authenticates by pairing, not by a launcher",
        role: "control-client",
      },
      {
        device: "android",
        state: "not-applicable",
        reason: "the phone authenticates by pairing, not by a launcher",
        role: "control-client",
      },
    ],
  },
  {
    key: "messaging",
    capability:
      "messaging: send and receive a ComsNet message that becomes a request on the rail (K02, K05)",
    serves: ["NG-018", "NG-025"],
    steps: "phone: open a thread, send one message, wait for the reply",
    expect:
      "the reply appears on the phone and the request is on the rail in the receiver's record",
    evidence: "<evidence_root>/T10.02/messaging-<device>.png",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T7.05",
        proof: "host",
        test: "a Mac seat and a tower seat exchange one request and one reply",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T7.05",
        proof: "host",
        test: "two tower seats exchange one request and one reply",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T7.05",
        proof: "host",
        test: "a Raspberry Pi seat and a tower seat exchange one request and one reply",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T7.05",
        proof: "physical",
        test: "an agent sends into a thread from the iPhone via Mirroring and sees the reply",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T7.05",
        proof: "physical",
        test: "same as iOS on the Android phone",
        witness: "needs-debugging-authorization",
        role: "control-client",
      },
    ],
    owned_by:
      "slices 4-7 preparer: host proposal T7.05 makes this row's cold test its done_when on every device role",
  },
  {
    key: "targets",
    capability:
      "targets: the first message becomes a candidate, JEV answers, code admits (K07, K08)",
    serves: ["NG-076", "NG-077"],
    steps: "open a thread with a first message; read its target state; on a phone, fix the target",
    expect: "work record exploring then admitted by code; a fix is an event",
    evidence: "<evidence_root>/T9.02 or T10.02/targets-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T9.02",
        proof: "host",
        test: "a thread opened on the Mac shows its target state",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T9.02",
        proof: "host",
        test: "a thread opened by a tower seat shows its target state",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T9.02",
        proof: "host",
        test: "same as the tower",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T10.02",
        proof: "physical",
        test: "the phone shows the target state and an agent fixes it from the phone",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T10.02",
        proof: "physical",
        test: "same as iOS",
        witness: "needs-debugging-authorization",
        role: "control-client",
      },
    ],
  },
  {
    key: "rewind",
    capability: "rewind: rewind to the first turn, repeatedly, in the same session (K06)",
    serves: ["NG-094", "NG-100"],
    steps: "rewind to the first turn twice",
    expect: "files unchanged; same session; Claude protection green",
    evidence: "<evidence_root>/T10.01 or T10.05/rewind-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T10.01",
        proof: "host",
        test: "Claude, Codex and Pi threads, twice each",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T10.01",
        proof: "host",
        test: "a tower-homed thread rewound from the Mac app",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T10.01",
        proof: "host",
        test: "a Raspberry Pi-homed thread rewound from the Mac app",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T10.05",
        proof: "physical",
        test: "the readable picker; rewind twice",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T10.05",
        proof: "physical",
        test: "the picker; rewind twice",
        witness: "needs-debugging-authorization",
        role: "control-client",
      },
    ],
  },
  {
    key: "voice",
    capability: "voice: voice and optimize through Message Optimizer with raw text preserved (K14)",
    serves: ["NG-108", "NG-071"],
    steps: "dictate or select text, optimize, undo",
    expect:
      "optimized text, original kept, undo restores, raw transcript kept, status shown, one central log row on the tower",
    evidence: "<evidence_root>/T10.07 or T10.08/voice-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T10.07",
        proof: "host",
        test: "composer dictate, optimize, undo; one Super Whisper dictation routed through the optimizer",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T10.07",
        proof: "host",
        test: "the full optimizer process runs here; each client request leaves one central log row",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "not-applicable",
        reason: "headless server with no desktop app (NG-142) and no microphone",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T10.08",
        proof: "physical",
        test: "dictate, optimize, undo on the iPhone",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T10.08",
        proof: "physical",
        test: "dictate, optimize, undo on the Android phone",
        witness: "needs-debugging-authorization",
        role: "control-client",
      },
    ],
  },
  {
    key: "voice-linux-desktop",
    capability: "voice-linux-desktop: voice and optimize in the Linux desktop app (NG-108)",
    serves: ["NG-108"],
    steps:
      "in the tower's desktop app: optimize a selection, undo; dictate if a capture device exists",
    expect: "as the voice row",
    evidence: "<evidence_root>/T10.07/voice-linux-desktop.json",
    cells: [
      {
        device: "mac",
        state: "not-applicable",
        reason: "covered by the voice row",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T10.07",
        proof: "host",
        test: "optimize a selection and undo in the tower's desktop app; dictate through the app once a microphone is confirmed on the capture node the tower has (A50)",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "not-applicable",
        reason: "no desktop app (NG-142)",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "not-applicable",
        reason: "covered by the voice row",
        role: "control-client",
      },
      {
        device: "android",
        state: "not-applicable",
        reason: "covered by the voice row",
        role: "control-client",
      },
    ],
  },
  {
    key: "pairing",
    capability: "pairing: agents pair and re-pair every device; logins renew (K05, IA-03)",
    serves: ["NG-129"],
    steps:
      "force-expire a login or install a fresh client build; an agent pairs it; complete one exchange",
    expect:
      "no token typed by Ryan; threads load; one exchange completes; denied permission shown as denied",
    evidence: "<evidence_root>/T12.02/pairing-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T12.02",
        proof: "host",
        test: "the app re-pairs itself to the tower and the Raspberry Pi after a forced expiry",
        role: "both",
      },
      {
        device: "twr",
        state: "not-applicable",
        reason: "the tower is the service being reached",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T12.02",
        proof: "host",
        test: "the Raspberry Pi server is paired and reachable from the Mac app after a forced expiry",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T12.02",
        proof: "physical",
        test: "An agent pairs a fresh iPhone build using current capabilities; a genuinely reserved physical act needs cited authority and an alternative. Threads load and one exchange completes.",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T12.02",
        proof: "physical",
        test: "an agent installs the Play internal-testing build and pairs it from broker custody; the phone's client appears in the tower record and subscribes to its threads",
        witness: "app-reported",
        role: "control-client",
      },
    ],
  },
  {
    key: "notailscale",
    capability: "notailscale: the app reaches the tower with Tailscale off (K05)",
    serves: ["NG-129", "NG-143"],
    steps: "turn Tailscale off on the client; open a thread; send",
    expect:
      "reaches the tower through the preserved route; if the record is unreachable the draft stays unsubmitted and history shows stale",
    evidence: "<evidence_root>/T12.06/notailscale-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T12.06",
        proof: "host",
        test: "Tailscale off on the Mac",
        role: "both",
      },
      {
        device: "twr",
        state: "not-applicable",
        reason: "the tower is the service being reached",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "not-applicable",
        reason: "a server, not a client of the preserved route",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T12.06",
        proof: "physical",
        test: "Tailscale off on the iPhone",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T12.06",
        proof: "physical",
        test: "Tailscale off on the Android phone",
        witness: "needs-debugging-authorization",
        role: "control-client",
      },
    ],
  },
  {
    key: "terminal",
    capability:
      "terminal: a thread reaches its own terminal drawer through the scoped admission (K14)",
    serves: ["NG-198"],
    requirement_decision: "resolved: deferred-exploration (A51)",
    steps:
      "none while deferred; existing terminal actions keep their scoped-admission control under T10.02",
    expect: "not part of whole-design acceptance",
    evidence: "none while deferred",
    cells: [
      {
        device: "mac",
        state: "deferred-exploration",
        ledger: "NG-198",
        reason: "ledger NG-198 is a Ryan exploration (A51); not part of whole-design acceptance",
        role: "both",
      },
      {
        device: "twr",
        state: "deferred-exploration",
        ledger: "NG-198",
        reason: "ledger NG-198 is a Ryan exploration (A51); not part of whole-design acceptance",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "deferred-exploration",
        ledger: "NG-198",
        reason: "ledger NG-198 is a Ryan exploration (A51); not part of whole-design acceptance",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "deferred-exploration",
        ledger: "NG-198",
        reason: "ledger NG-198 is a Ryan exploration (A51); not part of whole-design acceptance",
        role: "control-client",
      },
      {
        device: "android",
        state: "deferred-exploration",
        ledger: "NG-198",
        reason: "ledger NG-198 is a Ryan exploration (A51); not part of whole-design acceptance",
        role: "control-client",
      },
    ],
  },
  {
    key: "updates",
    capability: "updates: a client survives a server a release ahead or behind (K09)",
    serves: ["NG-119"],
    steps: "K09 test 1 cases",
    expect:
      "send, reconnect with a stale cursor, repeat rewind, late reply, settings and voice text preserved",
    evidence: "<evidence_root>/T13.03/updates-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T13.03",
        proof: "host",
        test: "old app against new server and the reverse",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T13.03",
        proof: "host",
        test: "new server against old clients",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T13.03",
        proof: "host",
        test: "same",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T13.03",
        proof: "physical",
        test: "the TestFlight build a release behind still sends and reconnects",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T13.03",
        proof: "physical",
        test: "the previous Play internal-testing build reconnects to the new server (app-reported); sending from it waits for the debugging authorization",
        witness: "app-reported for reconnect, needs-debugging-authorization for send",
        role: "control-client",
      },
    ],
  },
  {
    key: "copy-ids",
    capability: "copy-ids: copy thread id, session id and transcript path (NG-105)",
    serves: ["NG-105"],
    steps: "use the copy menu; paste each value; resolve it",
    expect: "each value resolves to the real thread, session and transcript file",
    evidence: "<evidence_root>/T10.04/copy-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T10.04",
        proof: "host",
        test: "Claude and Codex threads",
        role: "both",
      },
      {
        device: "twr",
        state: "not-applicable",
        reason:
          "execution-host role; the Linux desktop app inherits the Mac web build if D-CAP-04 makes it a client",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "not-applicable",
        reason: "headless server",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T10.04",
        proof: "physical",
        test: "the phone asks the owning host",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T10.04",
        proof: "physical",
        test: "same as iOS",
        witness: "needs-debugging-authorization",
        role: "control-client",
      },
    ],
  },
  {
    key: "settings",
    capability:
      "settings: a curated setting changed on one host lands on every eligible host; app settings survive upgrades (NG-114, IA-04)",
    serves: ["NG-114"],
    steps:
      "change one curated setting on the Mac; read effective values after one measured interval; upgrade the phone build",
    expect:
      "same effective value on eligible hosts; one event; phone settings unchanged after upgrade",
    evidence: "<evidence_root>/T10.10/settings-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T10.10",
        proof: "host",
        test: "origin of the change",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T10.10",
        proof: "host",
        test: "effective value read back",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T10.10",
        proof: "host",
        test: "effective value read back",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T10.10",
        proof: "physical",
        test: "app setting survives a TestFlight upgrade",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T10.10",
        proof: "physical",
        test: "app setting survives an Android upgrade",
        witness: "needs-debugging-authorization",
        role: "control-client",
      },
    ],
  },
  {
    key: "composer-carried",
    capability:
      "composer-carried: the carried composer and app features in the ledger's words (NG-109, NG-110)",
    serves: ["NG-109", "NG-110"],
    steps: "exercise each listed behavior on the installed build",
    expect: "every behavior observed; failures listed as gaps",
    evidence: "<evidence_root>/T10.09/composer-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T10.09",
        proof: "host",
        test: "Command+Shift+V inline paste, side chat, vault links open the link-router page, no turn-budget refusal, machine-first new thread",
        role: "both",
      },
      {
        device: "twr",
        state: "not-applicable",
        reason: "execution-host role",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "not-applicable",
        reason: "headless server",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T10.09",
        proof: "physical",
        test: "Return inserts a newline and only the send arrow sends; attachment limits are the app's own setting",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T10.09",
        proof: "physical",
        test: "same features as iOS where Android has them (NG-104: mobile and desktop have the same features)",
        witness: "needs-debugging-authorization",
        role: "control-client",
      },
    ],
  },
  {
    key: "limits",
    capability:
      "limits: headroom from the broker observer feeds dispatch and the Limits panel (IA-05)",
    serves: ["NG-141"],
    steps:
      "send a controlled observer response marking one account empty; dispatch a turn; open the Limits panel",
    expect:
      "empty account skipped until reset; panel lists every reported account with freshness Preserve all currently configured identities, including unloaded/unknown.",
    evidence: "<evidence_root>/T11.04/limits-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T11.04",
        proof: "host",
        test: "panel shows every reported account and freshness Preserve all currently configured identities, not only loaded observer rows.",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T11.04",
        proof: "host",
        test: "dispatch skips the empty account Preserve all currently configured identities, not only loaded observer rows.",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T11.04",
        proof: "host",
        test: "dispatch reads the same observer Preserve all currently configured identities, not only loaded observer rows.",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "not-applicable",
        reason: "not among the phone features Ryan named (NG-104, A29)",
        role: "control-client",
      },
      {
        device: "android",
        state: "not-applicable",
        reason: "not among the phone features Ryan named (NG-104, A29)",
        role: "control-client",
      },
    ],
  },
  {
    key: "re-entry",
    capability:
      "re-entry: a compacted Claude seat re-enters from the record; compaction settings unchanged (K06, IA-02)",
    serves: ["NG-196"],
    steps:
      "start a compaction by hand on a Claude seat (auto-compaction stays off); read the packet; read the auto-compaction settings of Claude, Codex and Pi on that host",
    expect:
      "packet released only at the current cut with its shapes; auto-compaction still off for Claude, Codex and Pi",
    evidence: "<evidence_root>/T8.02/reentry-<device>.json",
    cells: [
      {
        device: "mac",
        state: "required",
        owner: "T8.02",
        proof: "host",
        test: "one compaction on the Mac",
        role: "both",
      },
      {
        device: "twr",
        state: "required",
        owner: "T8.02",
        proof: "host",
        test: "one compaction under a dynamic account",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "required",
        owner: "T8.02",
        proof: "host",
        test: "one compaction",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "not-applicable",
        reason: "a phone never executes a provider",
        role: "control-client",
      },
      {
        device: "android",
        state: "not-applicable",
        reason: "a phone never executes a provider",
        role: "control-client",
      },
    ],
  },
  {
    key: "phone-theme",
    capability: "phone-theme: the phones carry the desktop color scheme and layout (NG-107)",
    serves: ["NG-107", "NG-104"],
    steps: "open three screens on the phone; screenshot; compare with the desktop",
    expect: "same scheme and theme",
    evidence: "<evidence_root>/T10.05/theme-<device>.png",
    cells: [
      {
        device: "mac",
        state: "not-applicable",
        reason: "the desktop scheme is the reference the phones copy",
        role: "both",
      },
      {
        device: "twr",
        state: "not-applicable",
        reason: "execution-host role",
        role: "execution-host",
      },
      {
        device: "rpi",
        state: "not-applicable",
        reason: "headless server",
        role: "execution-host",
      },
      {
        device: "ios",
        state: "required",
        owner: "T10.05",
        proof: "physical",
        test: "three screens via Mirroring",
        role: "control-client",
      },
      {
        device: "android",
        state: "required",
        owner: "T10.05",
        proof: "physical",
        test: "three screens",
        witness: "needs-debugging-authorization",
        role: "control-client",
      },
    ],
  },
];

// ---------- the source role of each decision's quote (K15) ----------
export type SourceRole =
  | "requirement"
  | "adopted-proposal"
  | "approving-context"
  | "fable-mechanism";
export const DECISION_SOURCES: Record<
  string,
  {
    role: SourceRole;
    note: string;
    reselect_from?: string[];
    quote_from_message?: string;
    quote_text?: string;
    previous_selection?: unknown;
    later_source_message?: string;
  }
> = {
  D01: { role: "requirement", note: "Ryan: an own repository, out of the vault, first slice" },
  D02: { role: "requirement", note: "Ryan: ad hoc installs unrepresentable" },
  D03: {
    role: "requirement",
    note: "Existing admitted Ryan done-state message: install through the last slice and make the original failing checks pass. Five-target scope remains D03/K09.",
    quote_from_message: "86b6faa1-a11f-446c-ba11-4c90ed0d22d8",
    quote_text:
      "So done is it doing that, and the agents being able to install without any guessing, any ambiguity, without them having to make any consequential decisions — they just install what Fable hands them.  And Fable is not off the hook until the last slice is installed and tested. The checks Fable designs and runs at the beginning that fail — those have to pass green at the end of this thing. And even though Fable's not installing, it's still responsible for what the agents do downstream of the design, architecture, and campaign it hands them.",
    previous_selection: {
      at: "2026-10-09",
      quote: "Awesome, now we're talking. This is sharp, this is The target, yes.",
      thread_id: "138eb1b9-75a0-4478-b636-dd6d3f26eb54",
      message_id: "0ee5e91e-4667-4978-b236-06fc8057b440",
      created_at: "2026-10-05T02:39:46.854Z",
      ledger_item: "NG-119",
    },
  },
  D04: { role: "requirement", note: "Ryan: every message on the Absurd substrate" },
  D05: { role: "requirement", note: "Ryan: nothing sidesteps the substrate" },
  D06: {
    role: "approving-context",
    note: "the quote is the earlier wish to explore accounts; the decision is Ryan's Oct 7 reply",
    reselect_from: ["0ee5e91e-4667-4978-b236-06fc8057b440", "Ryan-Reply-Export-2026-10-07.json"],
    later_source_message: "babd4dbd-9371-4766-a25a-f3d5c2ffeb46",
  },
  D07: { role: "requirement", note: "Ryan: CLI not MCP (Sep 10) and the Oct 7 reply" },
  D08: { role: "requirement", note: "Ryan: Agent Instruments folds; no watcher" },
  D09: {
    role: "approving-context",
    note: "the quote says compaction is off; the decision is the Oct 7 reply that it returns under a mod",
    reselect_from: ["5cf60252-4264-49fc-81ab-24e535213be9", "Ryan-Reply-Export-2026-10-07.json"],
    later_source_message: "babd4dbd-9371-4766-a25a-f3d5c2ffeb46",
  },
  D10: {
    role: "approving-context",
    note: "the quote is a good-call response; the preference text is in the Oct 4 message and the Oct 7 reply",
    reselect_from: ["5e48cbe3-8e02-49b0-a620-c580233125b0", "Ryan-Reply-Export-2026-10-07.json"],
    later_source_message: "babd4dbd-9371-4766-a25a-f3d5c2ffeb46",
  },
  D11: { role: "requirement", note: "Ryan: rewind to the first turn as many times as he likes" },
  D12: {
    role: "requirement",
    note: "Existing admitted Ryan target-order message: JEV before target save; K07/K08 and Fable call keep confidence and admission authority distinct.",
    quote_from_message: "5cf60252-4264-49fc-81ab-24e535213be9",
    quote_text:
      "I think the target should not save as a target until Jev has given an answer with a confidence score, and then we decide what the threshold is for My 1st turn to be a target or not. We don't want the system to load my turn as a target until Jev has responded.",
    previous_selection: {
      at: "2026-10-09",
      quote:
        "How much weight should it have? How much effect should it have? A governance, blocking?",
      thread_id: "2fc7f922-f6e1-41b3-a12d-e44bc55860cd",
      message_id: "0818cbd0-6c1a-45ff-af8b-0ec4232dcd06",
      created_at: "2026-10-03T03:44:58.228Z",
      ledger_item: "NG-138",
    },
  },
  D13: { role: "requirement", note: "Ryan: no additional upstream maintenance tax" },
  D14: {
    role: "approving-context",
    note: "the quote says ryan commands ThroughLine; the grammar standards are the authority (Ryan adopted them Oct 1 and Oct 5)",
    reselect_from: [
      "Command-Grammar-Standard-V1.html section 1",
      "Folder-Grammar-Standard-V1.html section 1",
    ],
  },
  D15: { role: "requirement", note: "Ryan: the narrow phase-one line, Oct 7" },
  D16: { role: "requirement", note: "Ryan: voice through Message Optimizer, Oct 7" },
  D17: {
    role: "fable-mechanism",
    note: "stock Absurd pinned; version chosen by Fable (0.5.0, K02)",
  },
  D18: { role: "fable-mechanism", note: "approved-by-silence ledger item; mechanism is Fable's" },
  D19: { role: "fable-mechanism", note: "copies not links, from the router measurement" },
  D20: { role: "requirement", note: "Ryan: the full shipping sequence, every device" },
  D21: {
    role: "fable-mechanism",
    note: "the acceptance node is Fable's mechanism for Ryan's done state",
  },
  D22: {
    role: "requirement",
    note: "Ryan: every message, mine or an agent's, is a ComsNet message, on every device",
  },
  D23: { role: "fable-mechanism", note: "K08 is Fable's answer to the open acceptance item" },
  D24: { role: "fable-mechanism", note: "K03 is Fable's reading of binding, not recording" },
};

// ---------- the whole-design acceptance node (K10) ----------
export const ACCEPTANCE = {
  id: "ACCEPT-ALL",
  title: "The whole design is accepted",
  rule: "a conjunction, computed by the checker and drawn by the map: every detailed task has a passed done check from a non-builder; every slice is detailed; every ledger item disposed implemented has a passed acceptance; every required device cell has a passed cold test; the seam count did not rise; every release is installed on the target set its run binding declares (0.0.60 declares twr, ios and mac; Android joins when T13.01 ships), and the last release before acceptance is installed on all four active targets from one commit; Raspberry Pi is explicitly deferred under IC-008 and never counted passed; the receipt-level evaluation is one evaluator, the accept-all mode of throughline-ship (T13.04), run by a non-builder; X14 checks the graph and never stands for the receipts; at first install live shell input is observe-only on every host and the controlled executor (T3.06) is deferred outside this conjunction, so acceptance never claims a live-input cell as bound, and the Mac execution cells are certified only with live shell input unavailable to bound seats (no live-input tool path, per the T3.01+F07 decision); a host where a bound seat can reach live shell input is not certified until T3.06 is detailed and required (K03 unchanged)",
  depends_on_rule: "every task, every slice, every precondition and every required device cell",
  test: "K10 test",
};

// Current split owners; generated acceptance excludes the explicitly deferred terminal cells.
for (const l of LEDGER) {
  if (l.id === "NG-198") {
    l.kind = "deferred-exploration";
    l.by = ["K14"];
    l.note =
      "Native terminal-drawer tooling remains the operator’s explicit exploration; existing terminal effects retain scoped admission.";
  }
  if (l.id === "NG-132")
    l.note =
      "The stable conversation identity carries every short request workflow’s native Pi session alias/cache key.";
  if (["NG-141", "NG-145", "NG-166", "NG-183"].includes(l.id))
    l.by = [...new Set([...l.by, "T11.04"])];
  if (l.id === "NG-114") l.by = [...new Set([...l.by, "T10.10"])];
}
AUDIT.find((a) => a.id === "IA-02")!.answered_by.push(...["T9.05"]);
AUDIT.find((a) => a.id === "IA-04")!.answered_by.push(...["T10.10"]);
AUDIT.find((a) => a.id === "IA-05")!.answered_by.push(...["T11.04", "T12.04"]);
AUDIT.find((a) => a.id === "IA-06")!.answered_by.push(...["T4.04", "T4.05", "T12.04"]);
AUDIT.find((a) => a.id === "IA-09")!.answered_by.push(...["T12.05"]);

ACCEPTANCE.rule +=
  " Final architecture acceptance also requires T3.07 upstream reconciliation bound to the installed source and T9.01 target-ID-only startup/succession plus cold read/add/fix/retract through each supported provider on every active execution host. Neither the lab nor the foundation release substitutes for those installed non-builder receipts.";

// IC-008 changes current acceptance, never the preserved admission snapshot.
for (const row of DEVICE_MATRIX) {
  for (const cell of row.cells)
    if (cell.device === "rpi" && cell.state === "required") {
      const original = structuredClone(cell);
      Object.assign(cell, {
        state: "deferred",
        reason:
          "IC-008: Raspberry Pi general installation, execution and device acceptance paused. Archive drive and watcher/responder are separate bounded exceptions; this cell is not passed.",
        instruction: "IC-008",
        counts_as_passed: false,
        deferred_contract: original,
      });
    }
}

ACCEPTANCE.rule +=
  " T11.05 owns installed target-ID-only provider succession after its target/provider prerequisites; all command-touching tasks also require their IC-002 grammar/caller-preservation receipt or an explicit not-applicable reason.";
