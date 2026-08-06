# Technical design

- PostgreSQL-backed registration state machine with advisory and row locks.
- Official QR registration SDK creates a tenant-owned confidential app.
- The app configuration endpoint adds the exact OAuth redirect and enables refresh tokens.
- QR-created confidential apps exchange codes with App Secret; the legacy store OAuth path retains PKCE S256.
- OAuth state is hashed at rest, single-use, ten-minute TTL, and prior unused states are invalidated on replacement.
- App, refresh, and access credentials use the independent Feishu AES-256-GCM key.
- OAuth persists a `provisioning` connection; the durable worker creates the Base/table and activates the mapping.
- The worker sweeps provisioning connections so a callback-to-enqueue interruption is recoverable.

Rollback is blocked before destructive DDL when any QR connection or retained app credential exists.
