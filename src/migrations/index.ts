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
]
