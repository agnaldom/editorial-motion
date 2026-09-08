# ADR-0002: Isolate vision processing in a Python service

- Status: Accepted
- Date: 2026-09-08

## Context

Detection, segmentation, inpainting, and image processing depend on Python ML and imaging ecosystems that should not leak into the API or renderer.

## Decision

Vision processing lives in `apps/vision-service` and exposes provider interfaces for detection, segmentation, inpainting, and route processing. The API communicates through stable schemas and internal endpoints.

## Consequences

Model providers can change independently. Local development needs Python dependencies, and production will eventually need isolated CPU/GPU deployment.
