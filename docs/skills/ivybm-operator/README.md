# IVYBM Operator Skill (RFC Prototype)

面向 OpenAI Codex、Claude Code 及私有 AI 智能体的运营辅助技能包（待评审原型）。

## 特性
- **零外部依赖**：基于 Node.js 18+ 原生 API，无需 `npm install`。
- **安全凭据管理**：AI 不接触明文密码，仅在客户端受限目录（`~/.ivybm/auth.json`）保存短期 JWT Token。
- **强制审发分离**：AI 负责素材准备、英阿双语内容组装与草稿送审；终审 Checklist 与三平台 API 发布严格在 `/dashboard` 由人类确认。

## 安装与快速开始

1. **安装到技能目录**：
```bash
mkdir -p ~/.codex/skills
cp -r docs/skills/ivybm-operator ~/.codex/skills/
```

2. **操作员手动登录**：
```bash
node docs/skills/ivybm-operator/bin/runner.cjs auth login
```
按照交互提示输入用户名与掩码密码，成功后获得会话 Token。

3. **对话式调度**：
在与 AI 助手的对话中即可直接通过自然语言指示其辅助工作，例如：
> “帮我把这个铝蜂窝幕墙板规格整理为英阿双语产品草稿，并起草一篇 LinkedIn 工程推文提交到后台。”
