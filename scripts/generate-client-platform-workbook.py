#!/usr/bin/env python3
"""Generate the customer-facing platform-account onboarding workbook.

Uses only Python's standard library so the workbook can be regenerated in CI or
on an operator machine without adding an application dependency.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


OUTPUT = Path("docs/client-materials/IVYBM_海外平台账号申请资料收集表.xlsx")
STATUS_FORMULA = '"未开始,已提供,待补充,不适用"'


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
    ]
    row_number = 4
    for heading, items in sections:
        rows.append(row_xml(row_number, [(heading, 3)]))
        row_number += 1
        for item in items:
            rows.append(row_xml(row_number, [(item, 4)]))
            row_number += 1
        row_number += 1

    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols><col min="1" max="1" width="125" customWidth="1"/></cols>
  <sheetData>{''.join(rows)}</sheetData>
  <mergeCells count="2"><mergeCell ref="A1:H1"/><mergeCell ref="A2:H2"/></mergeCells>
</worksheet>'''


def form_sheet(title: str, subtitle: str, entries: list[tuple[str, str, str, str, str]]) -> str:
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
            ("通过受控方式提供；不要填密码、App Secret、OAuth Token 或银行卡信息。", 9),
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
                ]),
                ("当前一期范围", [
                    "Meta：Facebook Messenger、Instagram DM 入站；Facebook / Instagram 图文发布。",
                    "LinkedIn：图文发布；LinkedIn 私信不属于一期自动接入范围。",
                    "TikTok：私信能力需先确认目标地区及官方 Business Messaging API 资格，当前为条件阻塞。",
                    "WhatsApp：不属于一期系统接入范围，请勿为本期申请。",
                ]),
                ("状态下拉说明", [
                    "未开始：尚未准备；已提供：已通过受控方式交付；待补充：资料不完整；不适用：确认无需提供。",
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
                ("B-09", "域名", "预生产 / 联调子域名", "必填", "例如 staging.example.com；需公网 HTTPS。"),
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
            "可由技术团队代办。请填写资产归属与负责人；没有账号时填“需新建”。",
            [
                ("M-01", "资产归属", "Meta Business 是否已有 / 需新建", "必填", "填写链接或“需新建”。"),
                ("M-02", "资产归属", "Meta Business 最终 Owner 姓名与企业邮箱", "必填", "不能用技术服务商个人账号作为最终 Owner。"),
                ("M-03", "Facebook Page", "Page 是否已有 / 希望创建的名称", "必填", "现有 Page 请提供 URL；新建请给英文名称。"),
                ("M-04", "Facebook Page", "Page 类别、公开电话、地址、简介", "必填", "用于创建或补全企业主页。"),
                ("M-05", "Instagram", "Instagram 账号是否已有 / 希望使用的用户名", "必填", "一期需转为商业账号并绑定 Facebook Page。"),
                ("M-06", "Instagram", "确认可转为商业账号并绑定 Page", "必填", "填写“确认”或说明限制。"),
                ("M-07", "Meta App", "开发者应用名称", "必填", "建议：品牌名 + Messaging。"),
                ("M-08", "Meta App", "应用最终管理员姓名 / 企业邮箱", "必填", "负责验证码、权限申请和最终接管。"),
                ("M-09", "Webhook", "预生产回调域名确认", "必填", "系统回调路径固定为 /api/webhooks/meta。"),
                ("M-10", "Webhook", "Meta Page ID（创建后补填）", "必填", "将进入服务器 allowlist；只填公开资产 ID。"),
                ("M-11", "Webhook", "Instagram Professional Account ID（创建后补填）", "必填", "将进入服务器 allowlist；只填公开资产 ID。"),
                ("M-12", "联调", "测试发送方 Facebook / Instagram 账号负责人", "必填", "用于 Development Mode 联调。"),
                ("M-13", "审核", "是否同意提交 App Review 和录制演示", "必填", "生产权限通常需要企业验证、说明与录屏。"),
                ("M-14", "发布", "Facebook / Instagram 图文发布是否纳入一期", "建议", "自动发布仍等待内容发布任务结构合并。"),
            ],
        ),
    ),
    (
        "LinkedIn",
        form_sheet(
            "LinkedIn：企业主页与图文发布",
            "个人身份账号必须由真实员工 / 负责人持有；不要创建或转交虚假个人 LinkedIn 账号。",
            [
                ("L-01", "个人管理员", "指定 LinkedIn 真实个人管理员姓名 / 企业邮箱", "必填", "后续应成为企业主页 Super Admin。"),
                ("L-02", "个人管理员", "管理员现有 LinkedIn Profile URL 或“需由本人新建”", "必填", "本人需完成 LinkedIn 验证及二次验证。"),
                ("L-03", "企业主页", "LinkedIn Company Page URL 或希望创建的英文名", "必填", "新建 Page 需品牌、官网、Logo、简介。"),
                ("L-04", "企业主页", "企业主页最终 Super Admin", "必填", "由客户侧负责人保留最高权限。"),
                ("L-05", "Developer App", "开发者应用名称", "必填", "技术团队可代建，资产归客户公司。"),
                ("L-06", "OAuth", "允许使用的 HTTPS 回调域名", "必填", "用于 LinkedIn OAuth redirect URL。"),
                ("L-07", "发布范围", "需要个人发帖、企业主页发帖，或两者", "必填", "两类权限与审核要求不同。"),
                ("L-08", "审核", "是否同意申请 Marketing / Community Management 权限", "建议", "企业主页自动发帖通常需要额外权限。"),
                ("L-09", "联调", "可用于测试发布的企业主页 / 审核人", "建议", "测试内容发布前需客户确认。"),
            ],
        ),
    ),
    (
        "TikTok",
        form_sheet(
            "TikTok：商业账号与私信资格确认",
            "TikTok 私信 API 受目标地区、商业账号资格和官方审核影响；本表用于资格确认，不承诺自动接入一定可用。",
            [
                ("T-01", "商业账号", "TikTok Business Account 是否已有 / 需新建", "必填", "提供链接 / ID 或填写“需新建”。"),
                ("T-02", "商业账号", "Business Account 最终 Owner 姓名 / 企业邮箱", "必填", "客户保留最高管理员。"),
                ("T-03", "地区", "目标运营国家 / 地区", "必填", "决定 Business Messaging API 的可用性。"),
                ("T-04", "主体", "是否可提供企业认证资料", "必填", "通常需营业执照、主体名称、地址等。"),
                ("T-05", "开发者", "TikTok for Developers 账号是否已有 / 需新建", "必填", "技术团队可代建。"),
                ("T-06", "资格", "是否已有 TikTok 客户经理 / 支持工单", "建议", "请提供联系人或工单号，不要提供密码。"),
                ("T-07", "资格", "官方是否确认该地区可用商业私信入站 API", "必填", "未确认则保持 blocked，不创建猜测接口。"),
                ("T-08", "联调", "测试 TikTok 商业账号与测试人员", "建议", "资格确认后再安排。"),
            ],
        ),
    ),
    (
        "技术、审核与交接",
        form_sheet(
            "技术部署、审核与最终交接",
            "本页用于安排域名、受控 secret 注入、审核材料和资产交接；不要填写任何真实 secret。",
            [
                ("H-01", "部署", "预生产环境负责人 / 联系方式", "必填", "用于公开 HTTPS 回调联调。"),
                ("H-02", "部署", "生产环境负责人 / 联系方式", "必填", "生产发布与 secret 注入需授权。"),
                ("H-03", "DNS", "可授权配置 DNS / TLS 的联系人", "必填", "用于 staging / production 域名和 HTTPS。"),
                ("H-04", "Secret", "确认 Meta App Secret 与 verify token 只写入服务器", "必填", "填写“确认”；不要在 Excel 填实际值。"),
                ("H-05", "审核", "App Review 业务用途说明负责人", "必填", "需说明客户如何使用消息和发布能力。"),
                ("H-06", "审核", "可提供审核录屏 / 截图的联系人", "必填", "Meta / LinkedIn 可能要求。"),
                ("H-07", "内容", "测试消息与测试发布内容确认人", "必填", "避免未经确认的公开发布。"),
                ("H-08", "交接", "客户最终接收企业邮箱、2FA、管理员权限的人", "必填", "账号开通后由其改密并保留恢复方式。"),
                ("H-09", "交接", "技术团队保留的角色与有效期", "建议", "例如 Developer / Technical admin，便于后续维护。"),
                ("H-10", "确认", "客户确认不向技术团队索要 / 提供密码、token、银行卡", "必填", "填写“确认”。"),
            ],
        ),
    ),
]


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
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
  <dc:creator>IVYBM</dc:creator><cp:lastModifiedBy>IVYBM</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>''')
        archive.writestr("docProps/app.xml", f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>IVYBM</Application><TitlesOfParts><vt:vector size="{len(SHEETS)}" baseType="lpstr">{''.join(f'<vt:lpstr>{escape(name)}</vt:lpstr>' for name in sheet_names)}</vt:vector></TitlesOfParts>
</Properties>''')
        archive.writestr("xl/workbook.xml", workbook_xml(sheet_names))
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_relationships(len(SHEETS)))
        archive.writestr("xl/styles.xml", STYLES)
        for index, (_, content) in enumerate(SHEETS, 1):
            archive.writestr(f"xl/worksheets/sheet{index}.xml", content)

    print(OUTPUT)


if __name__ == "__main__":
    main()
