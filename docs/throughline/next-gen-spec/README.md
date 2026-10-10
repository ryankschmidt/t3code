---
title: "ThroughLine next-generation specification"
description: "Repository-owned design sources, generated map and code-bound checks; execution records remain in the vault."
type: reference
status: active
created: "2026-10-08"
last_updated: "2026-10-09"
---

# ThroughLine next-generation specification

The design is edited here, at docs/throughline/next-gen-spec in the ThroughLine repository. Source files, the generated specification, HTML map, PNG, seam baseline and checker fixtures travel with the code. This private package owns js-yaml 4.1.1; its manifest and lockfile are separate from the repository workspace.

## Read and check the design

Run these commands from this directory. Building here means generating design documents, not building or releasing an app.

```sh
node build-spec.mts
node render-spec.mts
node check-spec.mts
node test-check-spec.mts
node checks/test-slice-1-checks.mts
node checks/test-repository-move.mts
node checks/slice-1-repository-move.mts --only S1-C10
```

Generated design-source and check-file references resolve from this specification's location, not a previous checkout or the shell's working directory. Check commands are intended to run from this directory. Real-disk checks still inspect the repository home and recorded host paths in spec.json; S1-C10 must be run again after the reviewed branch is merged into that home.

## Records stay in the vault

The orchestration entry, intent ledger, source quotations, reviews, execution orders and run receipts remain at /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07. Start there with START-HERE.txt and CURRENT.json for execution management. Nothing under _meta, execution, receipts, history or intent is copied into this design package; neither Move-Record.json nor Check-Run evidence belongs here. The builders and renderer read required ledger, quotation and run-state inputs at their physical vault addresses without moving them.

Spec-Map.html is regenerated from spec.json and carries its hash. Spec-Map.png is rendered from this HTML with render-html. The repository-move fixtures run through test-check-spec.mts as well as their standalone command; they use disposable Git repositories and files, not operator state.
