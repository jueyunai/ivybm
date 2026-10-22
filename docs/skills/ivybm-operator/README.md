# IVYBM Operator Skill

面向 OpenAI Codex、Claude Code 及私有 AI 智能体的 IVYBM 专属运营辅助技能包。

当前版本：`1.0.1-rc.2`（客户验收候选）。包含“照片＋介绍文档→案例草稿”的主动审查与询问流程；Windows 实机和真实 IVYBM 账号验收尚未执行，不能将本地验证描述为正式交付验收通过。

## 特性
- **零外部依赖**：基于 Node.js 18+ 原生 API，无需 `npm install`。
- **安全凭据管理**：AI 不接触明文密码，仅在客户端受限目录（`~/.ivybm/auth.json`）保存短期 JWT Token。
- **强制审发分离**：AI 负责素材准备、英阿双语内容组装与草稿送审；终审 Checklist 与三平台 API 发布严格在 `/dashboard` 由人类确认。

准备条件：安装 Node.js（最低 18，建议仍受支持的 22/24 LTS）；拥有 IVYBM 用户名及官网内容、素材库、AI 内容工作台的相应查看/编辑权限。单独安装包即可使用，不需要源码仓库、数据库、npm 依赖或系统管理员权限。其他 AI 助手需把同一目录安装到其支持的 Skill 目录，下文安装命令针对 Codex。

macOS/Linux 凭据文件设为 `0600`；Windows 使用当前用户个人目录及其账户访问权限，不能把 POSIX 文件模式当作 Windows ACL 保证。不要安装或保存凭据到共享账户目录。`auth status` 是本地检查，服务端仍会校验会话及权限。

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

`--public` 仅用于已获准公开的官网图片；社媒待审素材保持默认私有。可显式使用 `--public=false`，不能写 `--public false`。禁止跟随登录/API 跳转，跳转错误由平台维护人员排查。

人工终审和三平台正式发布仍在 [IVYBM 运营后台](https://ivybm.com/dashboard) 完成。

在本仓库内进行开发测试时，`SKILL_ROOT` 可以直接设置为 `docs/skills/ivybm-operator`；客户日常使用不需要进入源码仓库。

3. **对话式调度**：
在与 AI 助手的对话中即可直接通过自然语言指示其辅助工作，例如：
> “帮我把这个铝蜂窝幕墙板规格整理为英阿双语产品草稿，并起草一篇 LinkedIn 工程推文提交到后台。”

## 典型场景：一批照片和介绍文档，做一个项目案例

可直接告诉 AI：

> “根据这些照片和介绍文档，在 IVYBM 新增一个项目案例。先帮我检查资料，缺少重要信息请问我。”

AI 会先查看资料，再整理图片描述、选择封面及图库顺序、编写案例正文和 SEO 信息；默认做英阿双语并保存草稿。图片来源不明或资料冲突时主动询问；未获公开授权时先保持图片私有，要求对外使用时再核实公开授权。已说明的内容不重复问，能自动起草的字段不让您逐项填写。

图片来源必须真实，例如由您说明“我司自有实拍，有权上传，仅限内部草稿”或“摄影方已授权用于官网”；AI 不会从照片推断版权。暂未允许公开时图片保持私有；公开图片可能先于案例发布被访问，保存案例草稿不等于图片保密。介绍文档仅供编写，不自动公开上传。

上传逐张进行并记录描述、来源、素材 ID 和进度，随后自动关联封面和图库；中途结果不明就停止核对，不重新上传已成功的图片。给已有案例补图默认保留原图片及正文。流程详见 [案例工作流](references/case-workflow.md)；任务记录不是内置无人值守批处理或自动断点续传服务。

## 正式交付前验收

使用受控验收账号和明确授权的测试素材，完成：人工登录 → 上传素材 → EN 产品草稿创建 → AR 更新 → 完整社媒草稿创建/更新 → 送审，再在 `/dashboard` 核对 ID、文案、素材及 `review` 状态。若测试官网发布，还需明确授权并核对公开 EN/AR 页面；Skill 不代替人工完成社媒审批/发布。

案例场景另需验证：照片＋介绍文档 → 主动询问缺失来源/事实 → 多图各自 alt/source 上传 → 封面/图库关联 → EN/AR 草稿读回；补图保留原内容，中断后不重复创建。私有素材转公开由操作员在后台完成，不声称 runner 能修改既有媒体元数据。

交付 Windows 客户前，在 Windows PowerShell 实测首次安装、重复更新、带空格安装路径和交互登录，确认密码不回显。测试记录不得保存密码、Token 或客户原始资料。本地 HTTP fixture 证明 CLI 传输和失败恢复，不证明线上账号权限、数据库或社媒官方 API 已联调通过。
