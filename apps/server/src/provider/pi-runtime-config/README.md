---
title: Pi Runtime Config — Meridian Route Override
description: "Fork-versioned source of truth for pi's ~/.pi/agent/models.json provider override: retargets Anthropic-family transport to loopback Meridian (official Claude Code SDK) while OpenAI/Codex stays on pi native auth."
type: reference
status: active
created: 2026-07-06
last_updated: 2026-07-06
---

# Pi runtime config — the Meridian route override

`models.json` in this folder is the **fork-versioned source of truth** for
pi's provider-override config. The deployed copy lives at
`~/.pi/agent/models.json` on the operator's machine — that live file is
**deploy output**, not an editing surface. Change it here, then copy it out.

## What it does

This file IS the Anthropic route split (PLAN-T3-Meridian-Seam-Patch):

- `providers.anthropic.baseUrl` retargets pi's Anthropic-family HTTP
  transport to the loopback Meridian proxy (`http://127.0.0.1:3456`), which
  serves the request through the **official Claude Code SDK** on the
  operator's existing Claude login.
- `apiKey: "x"` is a **placeholder, not a credential**. Meridian
  authenticates through the Claude Code SDK; Anthropic-compatible clients
  merely require the field to be non-empty. Never replace it with a real
  Anthropic API key, and never log whatever value is present.
- `headers["x-meridian-agent"] = "pi"` selects Meridian's Pi adapter — pi
  mimics Claude Code's User-Agent, so automatic detection cannot work.
- `openai-codex` (and every other pi provider) is intentionally absent:
  OpenAI/Codex-family models stay on pi's native auth + transport,
  untouched by this override.

pi's own loop — system prompt, tools, thinking levels — is unchanged by
this file; only the Anthropic HTTP transport retargets. That keeps the
local customization/governance layer above the route split by construction.

Verified against the installed `@earendil-works/pi-coding-agent` 0.80.3:
provider-level `baseUrl`/`headers` overrides from `models.json` are applied
to all built-in models of that provider (`dist/core/model-registry.js`,
`loadBuiltInModels`), and stored auth-storage credentials do not clobber
the base URL (only the github-copilot OAuth provider rewrites model URLs).

## The T3-side guard

`apps/server/src/provider/Layers/PiMeridianRoute.ts` reads the DEPLOYED
copy at session/turn start: an Anthropic-family turn fails closed with a
visible, seam-naming runtime error when this override is absent/invalid or
when Meridian is unreachable at the configured loopback endpoint. There is
no silent fallback to pi native Anthropic OAuth.

## Meridian runtime config (Anthropic instruction channel)

Deployed copies (fork = source of truth):

- `meridian-sdk-features.json` → `~/.config/meridian/sdk-features.json` — pi adapter: `clientSystemPrompt: false`, `claudeMd: "project"`. Pi harness instructions were being sent through the wrong client/system-prompt channel; moving them into the Claude Code SDK's first-party project instruction channel fixed the request shape (replay differential 2026-07-06: pi's harness text as a client append 400'd, the same body without it passed, 2.5K of neutral text passed). Caller identity toward Anthropic stays the official SDK on the operator's login — Meridian strips `ANTHROPIC_*` env from the SDK subprocess and never forwards client auth/headers/UA (see the seam plan's transport-identity audit).
- `meridian-workdir-CLAUDE.md` → `$MERIDIAN_WORKDIR/CLAUDE.md` (`/Users/Admin/.config/meridian/workdir/`, set by `t3code/src/supervise/meridian.sh`) — pi's harness instructions, loaded by the Claude Code SDK as project instructions. DRIFT RISK: pi's system prompt evolves with pi versions/config — after a pi upgrade, re-capture (loopback recorder) and regenerate this file, then restart `com.ryan.meridian`.
