export const PLATFORM_PUBLICATION_JOB_TYPE = 'platform.publication.execute'

export const PUBLICATION_STATUS_OBLIGATION_DELAY_MS = 2_000

export const publicationStatusJobIdentity = (publishJobId: number, revision: number) => ({
  idempotencyKey: `publication-status:${publishJobId}:${revision}`,
  payload: { expectedExecutionRevision: revision, publishJobId },
  type: PLATFORM_PUBLICATION_JOB_TYPE,
})
