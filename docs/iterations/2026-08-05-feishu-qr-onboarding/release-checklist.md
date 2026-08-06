# Release checklist

- [x] Scope and non-goals frozen.
- [x] Credential and OAuth threat paths reviewed.
- [x] Migration up/down verified on an isolated database.
- [x] Controlled free-tenant end-to-end smoke passed.
- [x] Documentation and production preflight updated.
- [x] No secrets, tokens, local databases, or customer material intended for commit.
- [ ] GitHub CI policy passes on the PR head.
- [ ] jueyunai reviews shared collections, migration, Payload registration, and cross-module contracts.
- [ ] Draft PR is explicitly promoted to Ready.
- [ ] Production deployment receives separate human approval.

Rollback: disable `FEISHU_QR_REGISTRATION_ENABLED`; retain connected tenant credentials and Base resources. Schema rollback is intentionally blocked while credentials exist.
