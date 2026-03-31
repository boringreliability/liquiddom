# LiquidDOM Remediation Plan

**Date:** 2026-03-31
**Source:** Architectural review (GPT-5.4)

## Priority Order
1. P0: Ward 013-016 — Runtime lifecycle, teardown, memory bridge, capacity correctness
2. P1: Ward 017-020 — Tab sleep, HiDPI, a11y, container mode
3. P2: Ward 021-025 — Dynamic observation, physics stabilization, config, packaging, WDD hygiene

## Core Principle
Stabilize runtime and API before physics/visual enhancements.
The project is visually interesting enough — next leap comes from safety, predictability, and clean integration.

## Key Changes
- Replace singleton API with instance-based runtime
- Add explicit lifecycle management (create/destroy)
- Hide raw pointer/view rebinding behind internal bridge
- Fix capacity mismatch between TS and Rust
- Add tab sleep/pause/resume, HiDPI, reduced motion
- Container-scoped rendering mode
- NPM-ready packaging
