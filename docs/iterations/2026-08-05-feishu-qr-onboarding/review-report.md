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

Residual non-blocking boundary: QR polling is process-local and assumes the repository's long-running Compose app runtime; restart recovery and cleanup behavior are documented. No unresolved P0/P1 remains for a Draft PR.
