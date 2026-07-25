# 测试记录

已运行：

```text
python3 -m py_compile scripts/generate-client-platform-workbook.py
python3 scripts/generate-client-platform-workbook.py
unzip -t docs/client-materials/IVYBM_海外平台账号申请资料收集表.xlsx
```

并解析生成的 XLSX：7 个工作表存在；Meta、LinkedIn、TikTok、部署字段的 `dataValidation` 使用对应下拉公式；TikTok T-09/T-10 默认 `被阻塞（blocked）`。同步 HTML 已检查更新日期为 `2026-07-26`，且不再引用移除的本地截图；headless Chrome 由该 HTML 重建 PDF，产物为有效 8 页 PDF。

本机没有 `pandoc`，因此源 HTML 生成脚本未在本机完整运行；同步的 HTML 经静态检查无本地缺失截图路径，PDF 由本地 headless Chrome 从同步 HTML 重新生成。CI/有 pandoc 的文档环境应再次执行 HTML 生成脚本。
