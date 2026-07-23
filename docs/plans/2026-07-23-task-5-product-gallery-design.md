# Task 5 客户产品媒体与多图展示设计

## 目标

用客户已确认拥有版权的产品图片替换三个线上产品的临时 Unsplash 封面，并让已有 `Products.gallery` 在产品详情页形成可访问、响应式的多图浏览体验。客户原始文件只进入 production 媒体卷，不提交 Git。

## 方案

- 保留 `coverImage` 作为产品卡片、详情 Hero、SEO 与结构化数据的唯一主图；`gallery` 保存补充角度，最多 12 张。
- 服务端把主图放在第一位，过滤未展开关系、PDF 与空记录，并按媒体 ID 或 URL 去重；没有 gallery 时维持当前单图回退。
- 新增无第三方依赖的 Client Component：主图、上一张/下一张按钮、缩略图轨道、当前位置状态。英文与阿语使用各自可访问标签，RTL 下按钮图标与左右方向键符合视觉顺序。
- 主图使用 `contain`，避免白底产品渲染图在 16:10 容器里被裁掉；缩略图使用 `cover`。桌面保持现有双栏，移动端改为单栏并提供至少 44px 的触控目标。
- `Products.gallery` 只补后台说明和 12 张上限，不修改字段类型，不生成 migration，也不改变 API contract。

## 数据与发布

- 首批主图：`solid-aluminum-panel-01.jpg`、`single-curved-aluminum-panel-01.jpg`、`double-curved-aluminum-panel-04.jpg`。
- 图库：标准铝单板 5 张、单曲 6 张、双曲首批 4 张；低清晰度或拼图素材暂不公开。
- production 导入前备份数据库与媒体卷；新媒体记录填写准确 ALT、客户所有权 source 与 `isPublic=true`。更新产品引用后保留旧媒体，直到视觉验收完成，以便快速回退。

## 验证

- 单元测试覆盖主图优先、去重、非图片过滤、单图回退、缩略图切换及英文/阿语方向键。
- lint、typecheck、unit、production build 通过。
- 本地真实浏览器检查英文/阿语、桌面/移动端产品详情；production 发布后复核三个产品、图片响应、SEO 主图与健康接口。
