# IVYBM Operator Skill

面向 OpenAI Codex、Claude Code 及私有 AI 智能体的 IVYBM 专属运营辅助技能包。

## 特性
- **零外部依赖**：基于 Node.js 18+ 原生 API，无需 `npm install`。
- **安全凭据管理**：AI 不接触明文密码，仅在客户端受限目录（`~/.ivybm/auth.json`）保存短期 JWT Token。
- **强制审发分离**：AI 负责素材准备、英阿双语内容组装与草稿送审；终审 Checklist 与三平台 API 发布严格在 `/dashboard` 由人类确认。

## 安装与快速开始

1. **安装到 Skill 目录**：

   Skill 应安装到 Codex 的用户级 Skill 目录，不依赖当前业务项目目录，也不需要安装到系统 PATH。
   以下命令假设当前目录的下一层包含 `ivybm-operator/` 发布包；如果从本仓库根目录执行，将源目录替换为 `docs/skills/ivybm-operator`。

   macOS / Linux（`CODEX_HOME` 未设置时使用 `~/.codex`）：
```bash
SKILL_ROOT="${CODEX_HOME:-$HOME/.codex}/skills/ivybm-operator"
mkdir -p "$SKILL_ROOT"
cp -R ivybm-operator/. "$SKILL_ROOT/"
```

   Windows PowerShell：
```powershell
$ivybmCodexDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$skillRoot = Join-Path $ivybmCodexDir "skills\ivybm-operator"
New-Item -ItemType Directory -Force -Path $skillRoot | Out-Null
Get-ChildItem -LiteralPath ./ivybm-operator -Force | Copy-Item -Destination $skillRoot -Recurse -Force
```

2. **操作员手动登录**：

   IVYBM 专属 Skill 默认连接正式后台 `https://ivybm.com`，不需要客户输入后台地址。
```bash
node "$SKILL_ROOT/bin/runner.cjs" auth login
```
Windows PowerShell：
```powershell
node (Join-Path $skillRoot "bin\runner.cjs") auth login
```
按照交互提示输入用户名与密码；密码输入不显示字符或星号，回车提交。需使用交互式终端，不支持管道或输出重定向。成功后获得会话 Token。

安装命令也适用于更新：复制包内文件覆盖旧版，不会嵌套创建第二个 `ivybm-operator` 目录。凭据位于独立的用户目录，更新包不会覆盖登录凭据。

写操作超时或断线时，先在后台核对记录，不要直接重新创建。确需重试时保持请求参数不变，复用原来的 `--idempotency-key`；连接失败提示会显示该键。

人工终审和三平台正式发布仍在 [IVYBM 运营后台](https://ivybm.com/dashboard) 完成。

在本仓库内进行开发测试时，`SKILL_ROOT` 可以直接设置为 `docs/skills/ivybm-operator`；客户日常使用不需要进入源码仓库。

3. **对话式调度**：
在与 AI 助手的对话中即可直接通过自然语言指示其辅助工作，例如：
> “帮我把这个铝蜂窝幕墙板规格整理为英阿双语产品草稿，并起草一篇 LinkedIn 工程推文提交到后台。”
