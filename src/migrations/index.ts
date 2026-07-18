import * as migration_20260717_062939_initial from './20260717_062939_initial';
import * as migration_20260717_083319_auth_audit from './20260717_083319_auth_audit';
import * as migration_20260717_092625_cms_core from './20260717_092625_cms_core';
import * as migration_20260717_102058_cms_seo_completion from './20260717_102058_cms_seo_completion';
import * as migration_20260718_015857_cms_media_policy from './20260718_015857_cms_media_policy';
import * as migration_20260718_053459_task8_knowledge_base from './20260718_053459_task8_knowledge_base';
import * as migration_20260718_143701_task7_inquiry_leads from './20260718_143701_task7_inquiry_leads';

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
    name: '20260718_143701_task7_inquiry_leads'
  },
];
