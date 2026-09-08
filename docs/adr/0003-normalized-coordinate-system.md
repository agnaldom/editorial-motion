# ADR-0003: Store geometry in normalized coordinates

- Status: Accepted
- Date: 2026-09-08

## Context

The same scene may render at 1080p, 1440p, 4K, portrait, or square profiles. Pixel coordinates would couple analysis and plans to one resolution.

## Decision

Scene geometry, bboxes, anchors, placements, and planner coordinates use normalized values. The renderer converts them to pixels using the active canvas dimensions.

## Consequences

Plans are portable across output profiles. Every boundary must validate the 0..1 range and handle aspect-ratio differences explicitly.
