import * as migration_20260717_062939_initial from './20260717_062939_initial'

export const migrations = [
  {
    up: migration_20260717_062939_initial.up,
    down: migration_20260717_062939_initial.down,
    name: '20260717_062939_initial',
  },
]
