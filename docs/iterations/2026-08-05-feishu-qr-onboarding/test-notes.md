# Test notes

## Passed during finalization

- AI evaluation 60/60 and unit tests 667/667.
- Contract tests 70/70.
- Correctly seeded PostgreSQL integration tests 157/157, including Feishu routes and provisioning.
- Production preflight tests 11/11.
- Migration full down/up on the isolated CI database.
- Production build, TypeScript, ESLint (0 errors), Prettier, and diff checks.
- Controlled free-tenant QR creation, OAuth, automatic Base/table creation, and mapping activation.

## Environment limitation

Local Compose assertions require Docker CLI, which is unavailable on this host. Seven Compose assertions fail before evaluating configuration and remain a GitHub CI gate; the remaining operations tests pass.

No production data or production credentials were used.
