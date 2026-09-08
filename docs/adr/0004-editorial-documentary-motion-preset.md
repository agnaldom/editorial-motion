# ADR-0004: Use the editorial-documentary motion preset

- Status: Accepted
- Date: 2026-09-08

## Context

The product is an editorial explainer, not a general effects engine. Unrestrained animation would reduce readability and undermine the visual language.

## Decision

The default preset is static-camera, sequential, restrained, and explanatory. It allows subtle easing, reveals, route drawing, emphasis, and final holds while rejecting bounce, shake, spins, 3D flips, glow bursts, glitch spam, and decorative motion without purpose.

## Consequences

The engine has a narrow, testable style contract. More expressive styles require an explicit future preset or ADR rather than silently changing V1 behavior.
