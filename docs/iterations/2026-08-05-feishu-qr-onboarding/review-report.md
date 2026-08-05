# Review report

Independent native security and acceptance reviewers, OpenCode static review, and Claude architecture/security review inspected the full diff. A final focused verifier rechecked each prior P1 after fixes.

Resolved findings:

- Preserve and resume the same externally created app after configuration failure.
- Invalidate replaced OAuth states and prevent completed registration regression.
- Consume state on provider denial.
- Clear QR-only app fields on legacy reconnect and disconnect.
- Validate QR URLs against HTTPS Feishu/Lark domains.
- Poll provisioning status in the Portal.
- Move rollback guards before destructive DDL and cover every retained registration or connection app credential.
- Verify worker recovery when the immediate provisioning Job is absent.

## Third review follow-up

The 2026-08-05 16:33 UTC review of head `e763b17` (base `7ff9e74`) identified two P1 and two P2 findings:

- OAuth state cleanup now permits marker-only updates while rejecting changes to an existing `usedAt` value. Late callback recovery is guarded by the original processing marker, so it cannot invalidate a newer authorization.
- OAuth token exchange and user lookup use a shared callback signal with 30-second bounded requests; SDK app-registration begin has a local watchdog, and propagation settling observes abort.
- Configuration expiry now rechecks `configuring` and its deadline under the registration row lock before changing state; stale callback recovery is gated to a 30-second worker interval.
- PostgreSQL integration coverage now includes successful/denied/state-recovery cleanup, stale-configuration compare-and-set, and a late callback racing worker recovery.

Current verification is recorded in `test-notes.md`. The remaining boundary is unchanged: real PostgreSQL integration, Docker Compose assertions, and controlled-tenant smoke require isolated infrastructure and are not production-authorized by this PR.
