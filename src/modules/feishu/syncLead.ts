import type { FeishuClientPort, FeishuMappingConfig, LeadForFeishu } from './contracts'
import { mapLead } from './mapLead'

export const syncLead = async ({
  client,
  lead,
  mapping,
  signal,
}: {
  client: FeishuClientPort
  lead: LeadForFeishu
  mapping: FeishuMappingConfig
  signal?: AbortSignal
}): Promise<{ recordId: string; state: 'created' | 'updated' }> => {
  const mapped = mapLead({ lead, mapping })
  return client.upsertRecord({
    appToken: mapping.appToken,
    fields: mapped.fields,
    localLeadId: String(lead.id),
    localLeadIdField: mapped.localLeadIdField,
    signal,
    tableId: mapping.tableId,
  })
}
