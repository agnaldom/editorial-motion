# ADR-0001: Use Motion DSL instead of generated React

- Status: Accepted
- Date: 2026-09-08

## Context

An LLM must translate a natural-language motion prompt into an executable scene without introducing arbitrary code execution or nondeterministic renders.

## Decision

The planner outputs only versioned, strict Motion DSL JSON. Deterministic Remotion components interpret that JSON. The LLM never generates React, Remotion, JavaScript, or filesystem operations.

## Consequences

Rendering is reproducible and schema-testable. New motion primitives require engine changes, but future editors can modify plans without regenerating code.
