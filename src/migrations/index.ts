import * as migration_20260717_062939_initial from './20260717_062939_initial'
import * as migration_20260717_083319_auth_audit from './20260717_083319_auth_audit'
import * as migration_20260717_092625_cms_core from './20260717_092625_cms_core'
import * as migration_20260717_102058_cms_seo_completion from './20260717_102058_cms_seo_completion'

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
]
