#!/usr/bin/env python3
"""Generate the customer-facing platform-account onboarding workbook.

Uses only Python's standard library so the workbook can be regenerated in CI or
on an operator machine without adding an application dependency.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


OUTPUT = Path("docs/client-materials/IVYBM_海外平台账号申请资料收集表.xlsx")
STATUS_FORMULA = '"未开始,已提供,待补充,不适用"'
# Customer-facing document version stamp. Aligned with Task 13 platform readiness contract.
DOCUMENT_VERSION = "2026-07-25"
DOCUMENT_LAST_UPDATED = "2026-07-25"
# Customer-facing authorization-state options mirror the readiness contract enums (status only).
AUTHORIZATION_STATE_OPTIONS = (
    "未开始,待处理,已连接,已过期,被阻塞,已停用"
)
# Customer-facing capability approval state (separating messaging-inbound vs publishing).
APPROVAL_STATE_OPTIONS = (
    "未开始,待审核,已通过,被阻塞"
)
# Customer-facing deployment confirmation options for server-side allowlist / secrets.
DEPLOYMENT_CONFIRM_OPTIONS = (
    "待确认,已确认部署,无需部署,被阻塞"
)
# TikTok private-message schema / API eligibility options (explicitly blocked/pending).
TIKTOK_PM_BLOCK_OPTIONS = (
    "待官方确认,被阻塞,暂不可用"
)


def column_name(index: int) -> str:
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def cell(reference: str, value: str, style: int = 0) -> str:
    text = escape(str(value))
    return (
        f'<c r="{reference}" s="{style}" t="inlineStr">'
        f'<is><t xml:space="preserve">{text}</t></is></c>'
    )


def row_xml(number: int, values: Iterable[tuple[str, int]]) -> str:
    cells = "".join(cell(f"{column_name(index)}{number}", value, style) for index, (value, style) in enumerate(values, 1))
    return f'<row r="{number}">{cells}</row>'


def title_sheet(title: str, subtitle: str, sections: list[tuple[str, list[str]]]) -> str:
    rows = [
        row_xml(1, [(title, 1)]),
        row_xml(2, [(subtitle, 2)]),
        row_xml(3, [(f"文档版本：{DOCUMENT_VERSION}    最后更新：{DOCUMENT_LAST_UPDATED}    适用范围：海外平台账号申请资料收集（客户侧、非密）", 2)]),
    ]
    row_number = 5
    for heading, items in sections:
        rows.append(row_xml(row_number, [(heading, 3)]))
        row_number += 1
        for item in items:
            rows.append(row_xml(row_number, [(item, 4)]))
            row_number += 1
        row_number += 1

    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols><col min="1" max="1" width="125" customWidth="1"/></cols>
  <sheetData>{''.join(rows)}</sheetData>
  <mergeCells count="3"><mergeCell ref="A1:H1"/><mergeCell ref="A2:H2"/><mergeCell ref="A3:H3"/></mergeCells>
</worksheet>'''


def form_sheet(
    title: str,
    subtitle: str,
    entries: list[tuple[str, str, str, str, str]],
) -> str:
    headers = [
        "编号", "资料类别", "客户填写项", "客户填写内容", "必填程度", "用途 / 示例", "提供方式 / 注意事项", "状态",
    ]
    rows = [
        row_xml(1, [(title, 1)]),
        row_xml(2, [(subtitle, 2)]),
        row_xml(4, [(header, 5) for header in headers]),
    ]
    for row_number, (identifier, category, field, required, notes) in enumerate(entries, 5):
        required_style = 6 if required == "必填" else 7 if required == "建议" else 8
        rows.append(row_xml(row_number, [
            (identifier, 9),
            (category, 9),
            (field, 9),
            ("", 10),
            (required, required_style),
            (notes, 9),
            ("通过受控方式提供；不要填密码、验证码、App Secret、Client Secret、OAuth Token 或银行卡信息。", 9),
            ("未开始", 11),
        ]))

    end_row = 4 + len(entries)
    widths = [12, 19, 31, 43, 12, 48, 48, 13]
    columns = "".join(
        f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
        for index, width in enumerate(widths, 1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>{columns}</cols>
  <sheetData>{''.join(rows)}</sheetData>
  <autoFilter ref="A4:H{end_row}"/>
  <mergeCells count="2"><mergeCell ref="A1:H1"/><mergeCell ref="A2:H2"/></mergeCells>
  <dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="H5:H{end_row}"><formula1>{STATUS_FORMULA}</formula1></dataValidation></dataValidations>
</worksheet>'''


def content_types(sheet_count: int) -> str:
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, sheet_count + 1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  {overrides}
</Types>'''


def workbook_xml(sheet_names: list[str]) -> str:
    sheets = "".join(
        f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>'
        for index, name in enumerate(sheet_names, 1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets>{sheets}</sheets>
</workbook>'''


def workbook_relationships(sheet_count: int) -> str:
    rels = "".join(
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        for index in range(1, sheet_count + 1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {rels}
  <Relationship Id="rId{sheet_count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''


STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><color rgb="FF1F2937"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F4C5C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8F2F4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
</styleSheet>'''


SHEETS = [
    (
        "填写说明",
        title_sheet(
            "IVYBM 海外平台账号申请资料收集表",
            "请客户填写黄色单元格。所有密码、App Secret、OAuth Token、银行卡信息均不得填写在本表或通过聊天工具发送。",
            [
                ("填写原则", [
                    "1. 没有现成账号时，请在对应工作表填写“需新建”及希望使用的账号名；技术团队代为开设与配置。",
                    "2. 企业主体、品牌、页面和开发者应用最终归客户公司所有；请指定可接收验证码并完成最终接管的负责人。",
                    "3. 营业执照、身份证明等高敏感资料请通过受控文件夹或客户指定邮箱提供，只在表中写文件名或交付状态。",
                    "4. 所有“必填”项会影响账号创建、App Review 或真实联调；“建议”项可后补，但会延长审核时间。",
                    "5. 本表仅收集非密资料：外部账号 ID、授权状态、审批状态、部署确认等，绝对不要填密码、App Secret、Client Secret、OAuth Token、银行卡或验证码。",
                ]),
                ("当前一期范围（冻结）", [
                    "入站：Meta Facebook Messenger、Instagram DM、TikTok DM（TikTok 官方私信 schema 与 API 资格当前阻塞 / 待确认，不承诺自动接入）。",
                    "出站（图文发布）：Meta Facebook / Instagram（一期受 PublishJobs / PublishLogs / adapter 设计评审约束，暂不承诺自动联调）；LinkedIn 个人主页 / 企业主页（保留辅助导出 fallback）。",
                    "排除：WhatsApp 不进入一期系统接入；LinkedIn 私信不属于一期自动接入范围。",
                ]),
                ("字段口径说明", [
                    "Meta：区分 facebook-page 与 instagram-professional；分别填写外部 Page ID / Professional Account ID、授权状态、消息入站审批状态、图文发布审批状态，以及 allowlist / App Secret / Verify Token 部署确认（仅状态）。",
                    "LinkedIn：区分 linkedin-member（个人管理员）与 linkedin-organization（企业主页）；分别填写目标外部 ID、授权状态、发布 API 审批状态，以及客户侧 Super Admin 指定。",
                    "TikTok：tiktok-business 填写外部账号 ID、授权状态；私信 schema 与 API 资格当前统一标记为“被阻塞 / 待官方确认”，订单前再次确认，不承诺自动接入。",
                    "通用：所有“状态”列只填枚举值；不要把实际 secret、token、私信 schema 原文粘贴进表。",
                ]),
                ("状态下拉说明", [
                    "未开始：尚未准备；已提供：已通过受控方式交付；待补充：资料不完整；不适用：确认无需提供。",
                    "授权状态枚举：未开始、待处理、已连接、已过期、被阻塞、已停用。",
                    "审批状态枚举：未开始、待审核、已通过、被阻塞。",
                    "部署确认枚举：待确认、已确认部署、无需部署、被阻塞。",
                    "TikTok 私信当前口径枚举：待官方确认、被阻塞、暂不可用。",
                ]),
            ],
        ),
    ),
    (
        "企业与联系人",
        form_sheet(
            "企业主体与联系人",
            "用于企业认证、平台页面信息、审核联系和最终资产接管。黄色“客户填写内容”列由客户填写。",
            [
                ("C-01", "企业主体", "公司中文名称", "必填", "与营业执照一致。"),
                ("C-02", "企业主体", "公司法定英文名称", "必填", "用于 Meta、LinkedIn、TikTok 企业认证。"),
                ("C-03", "企业主体", "注册国家 / 地区", "必填", "例如：中国、阿联酋、沙特等。"),
                ("C-04", "企业主体", "注册地址（英文）", "必填", "与主体证明保持一致。"),
                ("C-05", "企业主体", "公司注册号 / 统一社会信用代码", "必填", "仅填编号；主体证件请受控交付。"),
                ("C-06", "企业主体", "营业执照 / 注册证明文件名或受控链接", "必填", "不要把身份证件嵌入 Excel。"),
                ("C-07", "负责人", "企业负责人姓名（中英文）", "必填", "用于平台验证、资产所有权与最终确认。"),
                ("C-08", "负责人", "负责人职位", "必填", "例如法人、总经理、市场负责人。"),
                ("C-09", "负责人", "负责人企业邮箱", "必填", "用于接收授权和审核通知。"),
                ("C-10", "负责人", "负责人手机号", "必填", "用于验证码 / 二次验证；不要写密码。"),
                ("C-11", "技术联系人", "技术 / 域名联系人及邮箱", "建议", "用于 DNS、HTTPS、部署协调。"),
                ("C-12", "授权", "书面授权确认人及日期", "必填", "确认可代办平台账号、开发者应用和审核。"),
            ],
        ),
    ),
    (
        "品牌与网站",
        form_sheet(
            "品牌、网站与合规页面",
            "用于平台主页创建、开发者应用资料、App Review 与 Webhook / OAuth 回调。",
            [
                ("B-01", "品牌", "品牌中文名 / 英文品牌名", "必填", "页面与应用展示名称。"),
                ("B-02", "品牌", "英文品牌简介（50–200 字）", "必填", "说明建材产品、客户类型和服务范围。"),
                ("B-03", "产品", "主营产品英文名称与卖点", "必填", "用于平台分类、审核说明和主页资料。"),
                ("B-04", "市场", "目标国家 / 地区", "必填", "影响平台资格与语言选择。"),
                ("B-05", "市场", "主要沟通语言", "必填", "例如英文、阿语。"),
                ("B-06", "素材", "Logo 文件名或受控链接", "必填", "建议 PNG / SVG，需确认拥有使用权。"),
                ("B-07", "素材", "企业 / 工厂 / 产品图片文件名或受控链接", "建议", "创建 Facebook、LinkedIn、TikTok 企业主页与审核演示。"),
                ("B-08", "域名", "正式官网域名", "必填", "用于隐私政策、合法性和生产回调。"),
                ("B-09", "域名", "生产受控联调域名", "必填", "例如 ivybm.com；一期没有常驻 staging，真实 Webhook 仅在获批的 production 受控窗口联调。"),
                ("B-10", "合规", "隐私政策 URL 或“请代建”", "必填", "Meta / LinkedIn 审核常用。"),
                ("B-11", "合规", "服务条款 URL 或“请代建”", "建议", "建议与隐私政策同时准备。"),
                ("B-12", "合规", "数据删除说明 URL 或“请代建”", "必填", "Meta 应用审核常用。"),
            ],
        ),
    ),
    (
        "Meta（Facebook+Instagram）",
        form_sheet(
            "Meta：Facebook Messenger、Instagram DM 与图文发布",
            "平台合约区分 facebook-page 与 instagram-professional。状态列只填枚举；App Secret / Verify Token / OAuth Token 真值不写入本表。",
            [
                ("M-01", "资产归属", "Meta Business 是否已有 / 需新建", "必填", "填写链接或“需新建”。"),
                ("M-02", "资产归属", "Meta Business 最终 Owner 姓名与企业邮箱", "必填", "不能用技术服务商个人账号作为最终 Owner。"),
                ("M-03", "facebook-page", "Facebook Page 是否已有 / 希望创建名称", "必填", "账号类型 = facebook-page；现有 Page 填 URL；新建给英文名称。"),
                ("M-04", "facebook-page", "facebook-page 外部 Page ID", "必填", "创建后补填；只填公开资产 ID，将进入服务器 allowlist。"),
                ("M-05", "facebook-page", "facebook-page 授权状态", "必填", f"从枚举中选：{AUTHORIZATION_STATE_OPTIONS}。"),
                ("M-06", "facebook-page", "Messenger 内容/订阅授权确认", "必填", "确认 Page 同意接收 Messenger 与 Webhook 订阅。"),
                ("M-07", "facebook-page", "facebook-page 消息入站审批状态", "必填", f"枚举：{APPROVAL_STATE_OPTIONS}；等待 App Review 通过才能进入生产。"),
                ("M-08", "facebook-page", "facebook-page 图文发布审批状态", "必填", f"枚举：{APPROVAL_STATE_OPTIONS}；当前一期联调以 PublishJobs / PublishLogs / adapter 评审为准。"),
                ("M-09", "instagram-professional", "Instagram 账号是否已有 / 希望使用的用户名", "必填", "账号类型 = instagram-professional；一期需转为商业账号并绑定 Facebook Page。"),
                ("M-10", "instagram-professional", "instagram-professional 外部 Account ID", "必填", "创建后补填；只填公开资产 ID，将进入服务器 allowlist。"),
                ("M-11", "instagram-professional", "instagram-professional 授权状态", "必填", f"枚举：{AUTHORIZATION_STATE_OPTIONS}。"),
                ("M-12", "instagram-professional", "instagram-professional 消息入站审批状态", "必填", f"枚举：{APPROVAL_STATE_OPTIONS}；等待 App Review。"),
                ("M-13", "instagram-professional", "instagram-professional 图文发布审批状态", "必填", f"枚举：{APPROVAL_STATE_OPTIONS}；以 PublishJobs / PublishLogs / adapter 评审为准。"),
                ("M-14", "Meta App", "开发者应用名称", "必填", "建议：品牌名 + Messaging。"),
                ("M-15", "Meta App", "应用最终管理员姓名 / 企业邮箱", "必填", "负责验证码、权限申请和最终接管。"),
                ("M-16", "Webhook", "production 受控回调域名确认", "必填", "系统回调路径固定为 /api/webhooks/meta；一期没有常驻 staging。"),
                ("M-17", "Webhook", "META_WEBHOOK_ALLOWED_ACCOUNT_IDS allowlist 部署确认", "必填", f"枚举：{DEPLOYMENT_CONFIRM_OPTIONS}；只填状态，不填真实 ID 列表。"),
                ("M-18", "Webhook", "META_WEBHOOK_APP_SECRET 部署确认", "必填", f"枚举：{DEPLOYMENT_CONFIRM_OPTIONS}；确认 App Secret 已写入服务器受控 storage，绝不写本表。"),
                ("M-19", "Webhook", "META_WEBHOOK_VERIFY_TOKEN 部署确认", "必填", f"枚举：{DEPLOYMENT_CONFIRM_OPTIONS}；确认 Verify Token 已写入服务器受控 storage，绝不写本表。"),
                ("M-20", "联调", "测试发送方 Facebook / Instagram 账号负责人", "必填", "用于 Development Mode 联调。"),
                ("M-21", "审核", "是否同意提交 App Review 和录制演示", "必填", "生产权限通常需要企业验证、说明与录屏。"),
                ("M-22", "发布", "Facebook / Instagram 图文发布是否纳入一期", "建议", "发布仍以 PublishJobs / PublishLogs / adapter 评审为前置条件；未评审通过不承诺自动联调。"),
            ],
        ),
    ),
    (
        "LinkedIn",
        form_sheet(
            "LinkedIn：企业主页与图文发布",
            "个人身份账号必须由真实员工 / 负责人持有；区分 linkedin-member 与 linkedin-organization，LinkedIn 私信不在一期范围。",
            [
                ("L-01", "linkedin-member", "真实个人管理员姓名 / 企业邮箱", "必填", "账号类型 = linkedin-member；必须由真实员工或负责人本人持有。"),
                ("L-02", "linkedin-member", "linkedin-member Profile URL 与外部 Member ID", "必填", "现有账号填写 URL / ID；无账号填写“需由本人新建”，不要创建或转交虚假个人账号。"),
                ("L-03", "linkedin-member", "linkedin-member 授权状态", "必填", f"枚举：{AUTHORIZATION_STATE_OPTIONS}；只填状态，不填 OAuth Token。"),
                ("L-04", "linkedin-organization", "企业主页 URL 或希望创建的英文名", "必填", "账号类型 = linkedin-organization；新建 Page 需品牌、官网、Logo、简介。"),
                ("L-05", "linkedin-organization", "linkedin-organization 外部 Organization ID", "必填", "创建后补填；只填公开组织 ID。"),
                ("L-06", "linkedin-organization", "linkedin-organization 授权状态", "必填", f"枚举：{AUTHORIZATION_STATE_OPTIONS}；只填状态，不填 OAuth Token。"),
                ("L-07", "企业主页", "客户侧最终 Super Admin", "必填", "由客户侧负责人保留最高权限，技术团队只保留获授权的有限角色。"),
                ("L-08", "Developer App", "开发者应用名称与最终管理员", "必填", "技术团队可协助创建，资产和最终控制权归客户公司。"),
                ("L-09", "OAuth", "生产 HTTPS 回调域名", "必填", "用于 LinkedIn OAuth redirect URL；一期没有常驻 staging。"),
                ("L-10", "发布权限", "个人 / 企业主页发布 API 审批状态", "必填", f"枚举：{APPROVAL_STATE_OPTIONS}；LinkedIn API 未获批时使用审核、素材清单和复制文案的辅助导出。"),
                ("L-11", "发布范围", "需要个人发帖、企业主页发帖，或两者", "必填", "两类权限与审核要求不同。"),
                ("L-12", "联调", "可用于测试发布的企业主页 / 审核人", "建议", "测试内容发布前需客户确认；未获权限不承诺自动发布。"),
            ],
        ),
    ),
    (
        "TikTok",
        form_sheet(
            "TikTok：商业账号与私信资格确认",
            "TikTok 私信 API 受目标地区、商业账号资格、官方 schema 与审核影响；当前仅记录阻塞与申请状态，不承诺自动接入。",
            [
                ("T-01", "tiktok-business", "TikTok Business Account 是否已有 / 需新建", "必填", "账号类型 = tiktok-business；提供链接或填写“需新建”。"),
                ("T-02", "tiktok-business", "tiktok-business 外部 Account ID", "必填", "创建后补填；只填公开账号 ID。"),
                ("T-03", "tiktok-business", "tiktok-business 授权状态", "必填", f"枚举：{AUTHORIZATION_STATE_OPTIONS}；只填状态，不填 access token。"),
                ("T-04", "商业账号", "Business Account 最终 Owner 姓名 / 企业邮箱", "必填", "客户保留最高管理员和恢复方式。"),
                ("T-05", "地区", "目标运营国家 / 地区", "必填", "决定官方能力是否可能开放。"),
                ("T-06", "主体", "是否可提供企业认证资料", "必填", "通常需营业执照、主体名称、地址等；证件通过受控方式提供。"),
                ("T-07", "开发者", "TikTok for Developers 账号是否已有 / 需新建", "必填", "技术团队可协助，客户保留最终管理员。"),
                ("T-08", "资格", "TikTok 客户经理 / 官方支持工单", "建议", "提供联系人或工单号，不要提供密码。"),
                ("T-09", "官方 schema", "私信入站 event schema 官方证据状态", "必填", f"当前口径：{TIKTOK_PM_BLOCK_OPTIONS}；填写官方文档链接、工单号或“待官方确认”，未确认时保持 blocked。"),
                ("T-10", "API 资格", "目标地区与商业账号私信 API eligibility 状态", "必填", f"当前口径：{TIKTOK_PM_BLOCK_OPTIONS}；未通过不得要求实现猜测 payload 或自动接入。"),
                ("T-11", "联调", "测试 TikTok 商业账号与测试人员", "建议", "仅在官方 schema 与资格均确认后安排受控联调。"),
            ],
        ),
    ),
    (
        "技术、审核与交接",
        form_sheet(
            "技术部署、审核与最终交接",
            "本页用于安排 production 受控联调、受控 secret 注入、审核材料和资产交接；一期没有常驻 staging，不要填写任何真实 secret。",
            [
                ("H-01", "部署", "production 受控联调负责人 / 联系方式", "必填", "真实 Webhook 与平台操作只在获批的 production 窗口执行。"),
                ("H-02", "部署", "生产环境负责人 / 联系方式", "必填", "生产发布、secret 注入与账号授权需由其确认。"),
                ("H-03", "DNS", "可授权配置 DNS / TLS 的联系人", "必填", "用于 production 域名、HTTPS 与平台回调校验；一期没有常驻 staging。"),
                ("H-04", "Secret", "Meta allowlist / App Secret / Verify Token 服务器部署确认", "必填", f"枚举：{DEPLOYMENT_CONFIRM_OPTIONS}；只填状态，绝不填真实值。"),
                ("H-05", "Secret", "平台 OAuth / access token 受控注入确认", "必填", f"枚举：{DEPLOYMENT_CONFIRM_OPTIONS}；token 只进入服务器受控 storage，不经 Excel、聊天或 PR 传递。"),
                ("H-06", "审核", "App Review 业务用途说明负责人", "必填", "需说明客户如何使用消息和发布能力。"),
                ("H-07", "审核", "可提供审核录屏 / 截图的联系人", "必填", "Meta / LinkedIn 可能要求。"),
                ("H-08", "内容", "测试消息与测试发布内容确认人", "必填", "避免未经确认的公开发布。"),
                ("H-09", "交接", "客户最终接收企业邮箱、2FA、管理员权限的人", "必填", "账号开通后由其改密并保留恢复方式。"),
                ("H-10", "交接", "技术团队保留的角色与有效期", "建议", "例如 Developer / Technical admin，便于后续维护。"),
                ("H-11", "确认", "客户确认不向技术团队索要 / 提供密码、token、银行卡", "必填", "填写“确认”。"),
            ],
        ),
    ),
]


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # The workbook is a customer-facing document. Pin the version / last-updated
    # marker to the aligned value (2026-07-25) so regeneration is reproducible and
    # the contract reference is stable across builds.
    now = f"{DOCUMENT_LAST_UPDATED}T00:00:00Z"
    sheet_names = [name for name, _ in SHEETS]

    with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types(len(SHEETS)))
        archive.writestr("_rels/.rels", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>''')
        archive.writestr("docProps/core.xml", f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>IVYBM 海外平台账号申请资料收集表</dc:title>
  <dc:subject>海外平台账号申请资料收集</dc:subject>
  <dc:creator>IVYBM</dc:creator>
  <cp:lastModifiedBy>IVYBM</cp:lastModifiedBy>
  <cp:version>{escape(DOCUMENT_VERSION)}</cp:version>
  <cp:contentStatus>draft-customer-facing</cp:contentStatus>
  <cp:keywords>IVYBM;海外平台;账号申请;Task13;非密;version={escape(DOCUMENT_VERSION)};lastUpdated={escape(DOCUMENT_LAST_UPDATED)}</cp:keywords>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>''')
        archive.writestr("docProps/app.xml", f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>IVYBM</Application>
  <Company>IVYBM</Company>
  <DocSecurity>0</DocSecurity>
  <HyperlinksChanged>false</HyperlinksChanged>
  <LinksUpToDate>false</LinksUpToDate>
  <ScaleCrop>false</ScaleCrop>
  <SharedDoc>false</SharedDoc>
  <TitlesOfParts><vt:vector size="{len(SHEETS)}" baseType="lpstr">{''.join(f'<vt:lpstr>{escape(name)}</vt:lpstr>' for name in sheet_names)}</vt:vector></TitlesOfParts>
</Properties>''')
        archive.writestr("xl/workbook.xml", workbook_xml(sheet_names))
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_relationships(len(SHEETS)))
        archive.writestr("xl/styles.xml", STYLES)
        for index, (_, content) in enumerate(SHEETS, 1):
            archive.writestr(f"xl/worksheets/sheet{index}.xml", content)

    print(OUTPUT)


if __name__ == "__main__":
    main()
