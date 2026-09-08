# ADR-0005: Abstract background reconstruction providers

- Status: Accepted
- Date: 2026-09-08

## Context

Moving extracted layers requires reconstructing the image behind them. Inpainting quality is provider- and model-dependent, so the pipeline must degrade safely.

## Decision

Use an `Inpainter` provider interface. The preferred V1 implementation is LaMa-compatible, with configurable Diffusers fallback. If reconstruction quality is insufficient, prefer reveal-based motion or an explicit failure over visibly broken cutout motion.

## Consequences

Providers can be replaced without changing orchestration. Quality checks and fallback behavior are mandatory, and the local development provider is not a production-quality inpainting implementation.
