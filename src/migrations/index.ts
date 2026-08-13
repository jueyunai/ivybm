import * as migration_20260717_062939_initial from './20260717_062939_initial'
import * as migration_20260717_083319_auth_audit from './20260717_083319_auth_audit'
import * as migration_20260717_092625_cms_core from './20260717_092625_cms_core'
import * as migration_20260717_102058_cms_seo_completion from './20260717_102058_cms_seo_completion'
import * as migration_20260718_015857_cms_media_policy from './20260718_015857_cms_media_policy'
import * as migration_20260718_053459_task8_knowledge_base from './20260718_053459_task8_knowledge_base'
import * as migration_20260718_143701_task7_inquiry_leads from './20260718_143701_task7_inquiry_leads'
import * as migration_20260719_014251_task9_conversations from './20260719_014251_task9_conversations'
import * as migration_20260719_123030_task9_public_knowledge_visibility from './20260719_123030_task9_public_knowledge_visibility'
import * as migration_20260719_174106_task10_jobs from './20260719_174106_task10_jobs'
import * as migration_20260720_034519_ai_control_plane from './20260720_034519_ai_control_plane'
import * as migration_20260720_140906_task8_embedding_indexing from './20260720_140906_task8_embedding_indexing'
import * as migration_20260721_105212_task8_index_owner_recovery from './20260721_105212_task8_index_owner_recovery'
import * as migration_20260721_150000_task8_ai_usage_logs from './20260721_150000_task8_ai_usage_logs'
import * as migration_20260725_044748_task13_platform_accounts from './20260725_044748_task13_platform_accounts'
import * as migration_20260725_051208_task13_tiktok_channel from './20260725_051208_task13_tiktok_channel'
import * as migration_20260730_035013_task11_feishu_oauth from './20260730_035013_task11_feishu_oauth'
import * as migration_20260801_232040_task11_feishu_followup_reminders from './20260801_232040_task11_feishu_followup_reminders'
import * as migration_20260802_042231_portal_v1 from './20260802_042231_portal_v1'
import * as migration_20260804_142542_publication_lifecycle from './20260804_142542_publication_lifecycle'
import * as migration_20260805_051559 from './20260805_051559'
import * as migration_20260806_170400_task13_oauth_authorization_revision from './20260806_170400_task13_oauth_authorization_revision'
import * as migration_20260809_103656_task8_knowledge_ingestion from './20260809_103656_task8_knowledge_ingestion'
import * as migration_20260811_162045_task9_qualification_rounds from './20260811_162045_task9_qualification_rounds'
import * as migration_20260812_113056_task9_optional_lead_country from './20260812_113056_task9_optional_lead_country'
import * as migration_20260812_163806_task13_platform_publishing_authority from './20260812_163806_task13_platform_publishing_authority'
import * as migration_20260812_173701_qualification_answer_state from './20260812_173701_qualification_answer_state'

export const migrations = [
  {
    up: migration_20260717_062939_initial.up,
    down: migration_20260717_062939_initial.down,
    name: '20260717_062939_initial',
  },
  {
    up: migration_20260717_083319_auth_audit.up,
    down: migration_20260717_083319_auth_audit.down,
    name: '20260717_083319_auth_audit',
  },
  {
    up: migration_20260717_092625_cms_core.up,
    down: migration_20260717_092625_cms_core.down,
    name: '20260717_092625_cms_core',
  },
  {
    up: migration_20260717_102058_cms_seo_completion.up,
    down: migration_20260717_102058_cms_seo_completion.down,
    name: '20260717_102058_cms_seo_completion',
  },
  {
    up: migration_20260718_015857_cms_media_policy.up,
    down: migration_20260718_015857_cms_media_policy.down,
    name: '20260718_015857_cms_media_policy',
  },
  {
    up: migration_20260718_053459_task8_knowledge_base.up,
    down: migration_20260718_053459_task8_knowledge_base.down,
    name: '20260718_053459_task8_knowledge_base',
  },
  {
    up: migration_20260718_143701_task7_inquiry_leads.up,
    down: migration_20260718_143701_task7_inquiry_leads.down,
    name: '20260718_143701_task7_inquiry_leads',
  },
  {
    up: migration_20260719_014251_task9_conversations.up,
    down: migration_20260719_014251_task9_conversations.down,
    name: '20260719_014251_task9_conversations',
  },
  {
    up: migration_20260719_123030_task9_public_knowledge_visibility.up,
    down: migration_20260719_123030_task9_public_knowledge_visibility.down,
    name: '20260719_123030_task9_public_knowledge_visibility',
  },
  {
    up: migration_20260719_174106_task10_jobs.up,
    down: migration_20260719_174106_task10_jobs.down,
    name: '20260719_174106_task10_jobs',
  },
  {
    up: migration_20260720_034519_ai_control_plane.up,
    down: migration_20260720_034519_ai_control_plane.down,
    name: '20260720_034519_ai_control_plane',
  },
  {
    up: migration_20260720_140906_task8_embedding_indexing.up,
    down: migration_20260720_140906_task8_embedding_indexing.down,
    name: '20260720_140906_task8_embedding_indexing',
  },
  {
    up: migration_20260721_105212_task8_index_owner_recovery.up,
    down: migration_20260721_105212_task8_index_owner_recovery.down,
    name: '20260721_105212_task8_index_owner_recovery',
  },
  {
    up: migration_20260721_150000_task8_ai_usage_logs.up,
    down: migration_20260721_150000_task8_ai_usage_logs.down,
    name: '20260721_150000_task8_ai_usage_logs',
  },
  {
    up: migration_20260725_044748_task13_platform_accounts.up,
    down: migration_20260725_044748_task13_platform_accounts.down,
    name: '20260725_044748_task13_platform_accounts',
  },
  {
    up: migration_20260725_051208_task13_tiktok_channel.up,
    down: migration_20260725_051208_task13_tiktok_channel.down,
    name: '20260725_051208_task13_tiktok_channel',
  },
  {
    up: migration_20260730_035013_task11_feishu_oauth.up,
    down: migration_20260730_035013_task11_feishu_oauth.down,
    name: '20260730_035013_task11_feishu_oauth',
  },
  {
    up: migration_20260801_232040_task11_feishu_followup_reminders.up,
    down: migration_20260801_232040_task11_feishu_followup_reminders.down,
    name: '20260801_232040_task11_feishu_followup_reminders',
  },
  {
    up: migration_20260802_042231_portal_v1.up,
    down: migration_20260802_042231_portal_v1.down,
    name: '20260802_042231_portal_v1',
  },
  {
    up: migration_20260804_142542_publication_lifecycle.up,
    down: migration_20260804_142542_publication_lifecycle.down,
    name: '20260804_142542_publication_lifecycle',
  },
  {
    up: migration_20260805_051559.up,
    down: migration_20260805_051559.down,
    name: '20260805_051559',
  },
  {
    up: migration_20260806_170400_task13_oauth_authorization_revision.up,
    down: migration_20260806_170400_task13_oauth_authorization_revision.down,
    name: '20260806_170400_task13_oauth_authorization_revision',
  },
  {
    up: migration_20260809_103656_task8_knowledge_ingestion.up,
    down: migration_20260809_103656_task8_knowledge_ingestion.down,
    name: '20260809_103656_task8_knowledge_ingestion',
  },
  {
    up: migration_20260811_162045_task9_qualification_rounds.up,
    down: migration_20260811_162045_task9_qualification_rounds.down,
    name: '20260811_162045_task9_qualification_rounds',
  },
  {
    up: migration_20260812_113056_task9_optional_lead_country.up,
    down: migration_20260812_113056_task9_optional_lead_country.down,
    name: '20260812_113056_task9_optional_lead_country',
  },
  {
    up: migration_20260812_163806_task13_platform_publishing_authority.up,
    down: migration_20260812_163806_task13_platform_publishing_authority.down,
    name: '20260812_163806_task13_platform_publishing_authority',
  },
  {
    up: migration_20260812_173701_qualification_answer_state.up,
    down: migration_20260812_173701_qualification_answer_state.down,
    name: '20260812_173701_qualification_answer_state',
  },
]
