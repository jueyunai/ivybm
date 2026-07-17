import * as migration_20260717_062939_initial from './20260717_062939_initial'
import * as migration_20260717_083319_auth_audit from './20260717_083319_auth_audit'

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
]
