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

## Third-review follow-up verification

- Full unit gate: AI evaluation 60/60; 100 files / 697 tests passed on Node 24.14.0.
- Contract tests: 70/70 passed.
- Targeted Feishu registration, OAuth, and maintenance tests: 19/19 passed.
- TypeScript, full ESLint (0 errors, 28 existing warnings), Prettier, and `git diff --check` passed.
- Production build exited successfully after TypeScript and route generation; static generation logged local PostgreSQL connection errors because the isolated database service is unavailable.
- PostgreSQL route integration could not start on this host because no `DATABASE_URL`, PostgreSQL service, or Docker CLI is available; the new real-database cases remain a CI/isolated-database gate.
- Operations tests: 40/47 passed; the seven Compose assertions stop before evaluation for the same unavailable Docker CLI condition. Production preflight and non-Compose operations tests passed.
