---
ward: 0
revision: null
name: ""
epic: ""
status: planned
dependencies: []
layer: typescript
estimated_tests: 0
created: ""
completed: null
---
# Ward {NNN}: {Name}

North star: {scene step(s) from .wdd/NORTH-STAR.md this ward moves, e.g. "step 3 (C)", or "none — <reason>"}

## Scope
{One paragraph: what this Ward builds and why}

## Inputs
{What this Ward reads/uses from previous Wards}

## Outputs
{What this Ward produces for future Wards}

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D{NN}-1: {Decision name}
Proposal: {what is proposed}
Consequence: {what it costs, changes or rules out}
Decision: PENDING

## Specification
{Detailed technical spec}

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | {test_name} | {what it proves} |

## Must NOT
- {Explicit constraint}

## Must DO
- {Explicit requirement}

## Manual Smoke Test
### Setup
{Exact commands to spin up — npm link, dev server, build, etc.}

### Steps
1. Run: `{exact command}`
   Expected: `{exact output or behavior}`
2. Run: `{next command}`
   Verify: `{what to look for}`

### Pass criteria
- [ ] {concrete observable thing}
- [ ] {concrete observable thing}

## Verification
{How to prove this Ward is complete}
