---
name: monotributo-copilot-ar
description: Operate Monotributo Copilot AR from natural-language requests by translating them into safe CLI workflows for invoices, fiscal reports, category, CCMA, recategorization and DFE. Use for monthly monotributo reviews, invoice dry-runs, read-only checks and preparation of actions that require human approval. Do not use as accounting or legal advice, to request a Clave Fiscal, or to execute VEP payments, credit reallocations or recategorization filings.
---

# Monotributo Copilot AR

Treat the agent as the user interface and this repository's CLI plus JSON artifacts
as its tool protocol. Translate the user's intent into inspectable commands; do not
hide uncertainty or irreversible actions behind a conversational answer.

## Operating contract

1. Work from the repository root and run `npm run doctor` before connected flows.
2. Start with read-only commands and explicit source files.
3. Preserve missing data as `incomplete` or `unknown`; never infer zero.
4. Show the evidence, generated artifact paths and proposed next action.
5. Stop for explicit approval immediately before any emission or other external
   side effect, then verify the result against ARCA before reporting success.

## Route the request

- Configuration health: `npm run doctor`
- Invoice preview: `npm run arca:dry-run -- --periodo YYYY-MM --cliente ID --source dev|real`
- Last authorized voucher: `npm run arca:last -- --cbte-tipo 11`
- Sales points: `npm run arca:sales-points`
- Fiscal report: `npm run fiscal -- report ...`
- Connected fiscal history: `npm run fiscal -- history ...`
- Minimal DFE registry: `npm run dfe -- merge ...`

Read `docs/operations.md` before an emission and `docs/agent-interface.md` when
designing a new agent workflow or adapter.

## Invoice safety

Dry-run is the default. Before proposing an emission, report recipient, document,
amount, currency, service period, due date, voucher type, sales point and target
environment. Homologation and production are different actions.

For production, require the repository's full flag set and exact confirmation
phrase. Never add `--force`. If the response is missing, timed out or ambiguous,
query the last voucher before any retry.

## Fiscal safety

Reports may consolidate evidence and prepare drafts, but the agent must not pay a
VEP, reallocate credits, file recategorization, answer a DFE notice or interpret an
extraordinary tax situation as routine. Explain why professional review is needed
and leave the action unexecuted.

Never ask the user to paste a Clave Fiscal, private key, certificate content, bank
export or client data into chat. Keep real inputs only in the ignored local paths
documented by the repository.
