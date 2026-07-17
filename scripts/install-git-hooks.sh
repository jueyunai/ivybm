#!/bin/sh

set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

git config core.hooksPath .githooks
chmod +x .githooks/pre-push

configured_path=$(git config --get core.hooksPath)
if [ "$configured_path" != ".githooks" ]; then
  printf '%s\n' "Git hooks 配置失败：$configured_path" >&2
  exit 1
fi

printf '%s\n' "已启用 IVYBM Git hooks：$configured_path"
printf '%s\n' "直接 push main 将被本地阻止。"
