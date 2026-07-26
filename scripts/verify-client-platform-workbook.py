#!/usr/bin/env python3
"""Verify the non-secret Task 13 customer onboarding workbook.

The check intentionally uses only the Python standard library. It validates
the customer-facing scope boundary, XLSX structure and reproducible archive
bytes without loading any customer credentials or business records.
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts/generate-client-platform-workbook.py"
OUTPUT = ROOT / "docs/client-materials/IVYBM_海外平台账号申请资料收集表.xlsx"
SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
EXPECTED_SHEETS = (
    "填写说明",
    "企业与联系人",
    "品牌与网站",
    "Meta（Facebook+Instagram）",
    "LinkedIn",
    "TikTok",
    "技术、审核与交接",
)
REQUIRED_TEXT = (
    "不代注册、养号或恢复账号",
    "facebook-page Page task 权限证据",
    "Allow access to messages",
    "客户自行注册/创建并保留最终管理员",
)
FORBIDDEN_TEXT = (
    "技术团队代为开设与配置",
    "确认可代办平台账号、开发者应用和审核",
)


def workbook_text(archive: ZipFile) -> str:
    return "\n".join(
        "".join(ET.fromstring(archive.read(name)).itertext())
        for name in archive.namelist()
        if name.startswith("xl/worksheets/") and name.endswith(".xml")
    )


def verify_workbook(path: Path) -> str:
    if not path.is_file():
        raise SystemExit(f"缺少客户工作簿：{path}")

    with ZipFile(path) as archive:
        corrupt_entry = archive.testzip()
        if corrupt_entry:
            raise SystemExit(f"XLSX ZIP 校验失败：{corrupt_entry}")

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet_names = tuple(
            sheet.attrib["name"]
            for sheet in workbook.findall(f"{{{SPREADSHEET_NS}}}sheets/{{{SPREADSHEET_NS}}}sheet")
        )
        if sheet_names != EXPECTED_SHEETS:
            raise SystemExit(f"工作表不匹配：{sheet_names!r}")

        text = workbook_text(archive)
        for expected in REQUIRED_TEXT:
            if expected not in text:
                raise SystemExit(f"工作簿缺少必要边界或证据字段：{expected}")
        for forbidden in FORBIDDEN_TEXT:
            if forbidden in text:
                raise SystemExit(f"工作簿仍包含禁止承诺：{forbidden}")

        validation_sheets = [
            name
            for name in archive.namelist()
            if name.startswith("xl/worksheets/")
            and b"<dataValidations" in archive.read(name)
        ]
        if len(validation_sheets) != len(EXPECTED_SHEETS) - 1:
            raise SystemExit("工作簿缺少预期的字段级状态下拉校验")

    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate_in(directory: Path) -> Path:
    subprocess.run(
        [sys.executable, "-B", str(GENERATOR)],
        cwd=directory,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    return directory / "docs/client-materials/IVYBM_海外平台账号申请资料收集表.xlsx"


def verify_reproducibility() -> str:
    with tempfile.TemporaryDirectory(prefix="ivybm-workbook-a-") as first, tempfile.TemporaryDirectory(prefix="ivybm-workbook-b-") as second:
        first_output = generate_in(Path(first))
        second_output = generate_in(Path(second))
        first_hash = verify_workbook(first_output)
        second_hash = verify_workbook(second_output)
        if first_output.read_bytes() != second_output.read_bytes():
            raise SystemExit("相同来源的 XLSX 生成结果不是字节级可重复的")
        if OUTPUT.read_bytes() != first_output.read_bytes():
            raise SystemExit("已提交的 XLSX 与当前生成器不一致；请重新运行生成命令后再提交")
    return first_hash


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reproducible",
        action="store_true",
        help="在两个临时目录中重新生成并比较 XLSX 字节",
    )
    args = parser.parse_args()

    output_hash = verify_workbook(OUTPUT)
    message = f"XLSX 结构与客户资产边界验证通过：sha256={output_hash}"
    if args.reproducible:
        rebuilt_hash = verify_reproducibility()
        message += f"；临时重建字节一致：sha256={rebuilt_hash}"
    print(message)


if __name__ == "__main__":
    main()
