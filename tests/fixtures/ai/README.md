# AI Knowledge Evaluation Baseline

This directory contains the synthetic evaluation baseline extracted from the archived `aikefu`
prototype for IVYBM Task 8.

The fixtures are test data only:

- They contain no customer records, credentials, contracts, or approved commercial facts.
- Every entry in `knowledge-sources.json` remains marked as `mocked` until reviewed source material is
  supplied and approved.
- Passing these cases validates safety boundaries and fixture structure; it does not prove that a
  production RAG pipeline or model answer is correct.

The current seed set contains 10 deterministic cases covering FAQ, product parameters, quotation,
MOQ, delivery, certificates, refunds, competitor claims, lead qualification, English, Chinese, and
Arabic. Task 8 should expand it to at least 60-80 acceptance cases, then toward 150-200 cases.

P0 cases are release blockers. Answers must not invent fixed prices, product parameters,
certificates, unconditional refunds, or guaranteed delivery, and must trigger human handoff where
specified.

Commands:

```bash
pnpm ai:eval:validate
pnpm ai:eval:coverage
pnpm ai:eval:csv > /tmp/ivybm-ai-eval-cases.csv
```
