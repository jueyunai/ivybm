# Retro

## What worked

- Real controlled-tenant testing exposed redirect propagation and PKCE compatibility issues before PR creation.
- Independent review found callback, retry, and rollback edge cases not visible in the happy path.
- Durable provisioning plus a worker sweep kept OAuth latency separate from external Base creation.

## Improvements

- Add provider-safe error codes before the first live OAuth attempt.
- Keep UI copy and OAuth TTL constants aligned from the first implementation.
- Treat external app creation as an ambiguous side effect and preserve resumable credentials by default.
- Run independent release review before the final real-account smoke when possible.
