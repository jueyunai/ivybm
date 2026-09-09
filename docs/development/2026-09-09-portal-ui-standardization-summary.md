# Admin Portal UI 下拉组件与搜索框标准化及缺陷修复总结

**日期**：2026-09-09  
**分支**：`feat/portal-ui-standardization`  
**涉及模块**：Portal Core UI (`UiSelect`, `portal.css`), AI 内容工作台 (`ContentStudio`), 知识库 (`KnowledgeWorkspace`), 线索管理 (`LeadsHub`), 官网内容 (`ContentHub`), 素材库 (`MediaWorkspace`), 社交平台配置 (`PlatformReadinessPage`) 等。

---

## 1. 缺陷排查与修复内容

### 1.1 `UiSelect` 非受控锁死与状态切换异常
- **根因**：原 `UiSelect` 试图基于 Radix UI `Select.Root` 实现，但将非受控默认值计算后直接传给受控的 `value` prop，且没有内部状态管理更新。导致在非受控表单或未绑定 `onChange` 重新渲染外部父组件受控状态的页面中，点击选项完全无法切换、值被锁死。
- **修复**：在 `UiSelect` 内部引入 `uncontrolledValue` 状态并在 `onValueChange` 时触发更新；通过 React 推荐的 render 阶段 `prevDefaultValue` 差异对比安全同步外部 `defaultValue` 的变更；同时完整保留受控模式的优先级。

### 1.2 下拉项悬浮/获焦“伪阴影/粗蓝边框”
- **根因**：全局样式中存在 `.portal-shell :focus-visible { outline: 2px solid ...; outline-offset: 2px; }`。当 Radix UI 的 Select Item 获得键盘或鼠标选中焦点触发 `:focus-visible` 时，被施加了 2px 实线边框及 offset 留白，在视觉上表现为下移或 hover 阴影/重影。
- **修复**：在 `src/admin-portal/core/styles/portal.css` 中重置 `.portal-ui-select__option` 及其 `:focus`、`:focus-visible`、`[data-highlighted]` 的 outline 与 box-shadow，统一定制为主题品牌背景淡蓝高亮和左侧主色指示条，恢复干净利落的视觉效果。

### 1.3 AI 内容工作台 (`/dashboard/content-studio`) 筛选与表单体验
- **筛选栏不可用与文案修复**：
  - 修正状态下拉首项从“状态”改为国际化规范的“全部状态 (`allStatus`)”。
  - 补充“全部平台 (`allPlatforms`)”与“清除筛选 (`resetFilters`)”。
  - 接入受控绑定与 `updateFilters` 联动，实现选择状态/平台即选即查。
- **新增/修改表单原生下拉替换**：
  - 排查“手动新建草稿”弹窗与“AI 生成草稿”弹窗，将其中的 5 处原生 HTML `<select>` 彻底替换为定制的 `UiSelect`，实现全工作台组件风格与交互完全一致。

### 1.4 线索管理 (`/dashboard/leads`) 筛选切回“全部状态”异常
- **根因**：`LeadsHub.tsx` 的 `updateFilters` 逻辑在接收到 `'all'` 时，参数处理未能正确从 URLSearchParams 中剔除旧筛选参数，导致点击“全部状态”或“全部意向”后 URL 仍然保留原有值。
- **修复**：重写 `updateFilters` 清理逻辑，切换为 `'all'` 或空串时明确 `delete` 对应 query key，页面顺畅切回全量线索视图。

### 1.5 官网内容 (`ContentHub`) 与素材库 (`MediaWorkspace`) 即选即查联动
- 完善下拉项变更时的即时导航联动 (`useRouter().push`)，统一全站列表工具栏的筛选与搜索交互。
- 规范 `portal.css` 中搜索框 `.portal-search__input` 的聚焦外观，消除内外两层聚焦边框冲突。

---

## 2. 验证与门禁结果

1. **类型检查**：`pnpm typecheck` → **0 错误**。
2. **ESLint 代码规范**：`pnpm eslint --quiet src tests` → **0 错误**（修复了 React Compiler Hook 声明顺序与 manual-memoization 规则）。
3. **单元测试与回归套件**：
   - 运行全套后台测试：`pnpm vitest run tests/unit/admin-portal*`
   - **48 个测试文件全部通过（48 passed），共计 338 个用例全部通过（338 passed）**。
