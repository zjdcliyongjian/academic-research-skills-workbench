from __future__ import annotations

import csv
import hashlib
import json
import os
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "测试数据" / "科研工作台全流程测试包-2026-09-21"
QA = ROOT / "tmp" / "test-pack-qa"
OUT.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)

FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\msyh.ttc"),
    Path(r"C:\Windows\Fonts\msyh.ttf"),
    Path(r"C:\Windows\Fonts\simhei.ttf"),
]
FONT_PATH = next((path for path in FONT_CANDIDATES if path.exists()), None)
if not FONT_PATH:
    raise RuntimeError("No Chinese font found")


def pil_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    bold_candidates = [Path(r"C:\Windows\Fonts\msyhbd.ttc"), Path(r"C:\Windows\Fonts\simhei.ttf")]
    target = next((path for path in bold_candidates if path.exists()), FONT_PATH) if bold else FONT_PATH
    return ImageFont.truetype(str(target), size=size)


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, color: str = "D9D9D9", size: str = "6") -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:color"), color)


def remove_paragraph_border(paragraph) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    border = p_pr.find(qn("w:pBdr"))
    if border is not None:
        p_pr.remove(border)


def set_run_font(run, name: str, size: float, bold: bool = False, color: str = "000000") -> None:
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)


def create_docx() -> Path:
    output = OUT / "01-研究方案与实验设计.docx"
    doc = Document()
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(0.75)
    section.left_margin = Inches(0.85)
    section.right_margin = Inches(0.85)

    normal = doc.styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor(23, 33, 29)
    title_style_ppr = doc.styles["Title"]._element.get_or_add_pPr()
    title_style_border = title_style_ppr.find(qn("w:pBdr"))
    if title_style_border is not None:
        title_style_ppr.remove(title_style_border)

    title = doc.add_paragraph(style="Title")
    title.alignment = WD_ALIGN_PARAGRAPH.LEFT
    remove_paragraph_border(title)
    run = title.add_run("小样本工业异常检测研究方案")
    set_run_font(run, "Microsoft YaHei", 24, True)
    title.paragraph_format.space_after = Pt(8)

    subtitle = doc.add_paragraph()
    subtitle.paragraph_format.space_after = Pt(18)
    run = subtitle.add_run("科研工作台合成测试数据  文档编号 TEST-RP-2026-01")
    set_run_font(run, "Microsoft YaHei", 10, False, "5F6B66")

    intro = doc.add_paragraph()
    intro.paragraph_format.space_after = Pt(16)
    run = intro.add_run("本文件用于验证课题资料上传、正文抽取、证据整理和研究路线生成。所有样本、指标和结论均为合成测试数据，不得用于正式论文或生产决策。")
    set_run_font(run, "Microsoft YaHei", 11, True, "06473F")

    sections = [
        ("研究背景", "工业视觉检测往往依赖大量缺陷样本，但真实产线中的异常样本稀少且分布不均。测试课题关注在有限标注条件下，联合视觉特征、设备日志和工艺参数，提高异常检测的稳定性与可解释性。"),
        ("研究问题", "当每类异常只有 5 至 20 个标注样本时，多模态证据融合能否降低误报率，并在设备、光照和批次变化下保持稳定表现？"),
        ("研究目标", "构建一套可复现实验流程，对比图像单模态基线、日志单模态基线和多模态融合方法，输出准确率、召回率、F1 值、误报率和跨批次稳定性。"),
        ("假设", "与单模态基线相比，多模态融合方法在小样本场景下能够提升异常召回率，并降低跨批次性能波动。该假设需要通过独立验证集检验。"),
    ]
    for heading, body in sections:
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.space_before = Pt(10)
        paragraph.paragraph_format.space_after = Pt(5)
        run = paragraph.add_run(heading)
        set_run_font(run, "Microsoft YaHei", 14, True)
        paragraph = doc.add_paragraph(body)
        paragraph.paragraph_format.line_spacing = 1.55
        paragraph.paragraph_format.space_after = Pt(8)

    heading = doc.add_paragraph()
    heading.paragraph_format.page_break_before = True
    heading.paragraph_format.space_before = Pt(10)
    heading.paragraph_format.space_after = Pt(7)
    set_run_font(heading.add_run("实验设计"), "Microsoft YaHei", 14, True)
    table = doc.add_table(rows=1, cols=4)
    table.autofit = False
    widths = [1.35, 1.7, 1.7, 2.05]
    for idx, width in enumerate(widths):
        table.columns[idx].width = Inches(width)
    headers = ["实验组", "输入", "主要方法", "评价重点"]
    for idx, text in enumerate(headers):
        cell = table.rows[0].cells[idx]
        cell.text = text
        set_cell_shading(cell, "06473F")
        set_cell_border(cell)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        for run in cell.paragraphs[0].runs:
            set_run_font(run, "Microsoft YaHei", 9.5, True, "FFFFFF")
        cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    rows = [
        ["A 基线", "产品图像", "轻量卷积网络", "准确率与误报率"],
        ["B 基线", "设备日志", "梯度提升树", "异常召回率"],
        ["C 融合", "图像 日志 工艺参数", "特征级融合", "F1 值与跨批次稳定性"],
    ]
    for row_index, values in enumerate(rows):
        cells = table.add_row().cells
        for idx, text in enumerate(values):
            cells[idx].text = text
            set_cell_border(cells[idx])
            cells[idx].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if row_index % 2 == 1:
                set_cell_shading(cells[idx], "F2F7F5")
            for run in cells[idx].paragraphs[0].runs:
                set_run_font(run, "Microsoft YaHei", 9.5)
            cells[idx].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER if idx != 2 else WD_ALIGN_PARAGRAPH.LEFT

    heading = doc.add_paragraph()
    heading.paragraph_format.space_after = Pt(8)
    set_run_font(heading.add_run("数据与评估计划"), "Microsoft YaHei", 18, True)
    bullets = [
        "训练集：正常样本 420 条，异常样本 48 条；按设备与批次分层抽样。",
        "验证集：正常样本 120 条，异常样本 18 条；与训练集设备时间窗口隔离。",
        "测试集：保留 3 个后续批次，用于评估分布变化下的性能稳定性。",
        "人工复核：对所有误报和漏报样本进行双人复核，记录争议标签。",
        "停止条件：若异常召回率低于 85%，不得进入正式部署评估。",
    ]
    for item in bullets:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.line_spacing = 1.4
        run = p.add_run(item)
        set_run_font(run, "Microsoft YaHei", 11)

    heading = doc.add_paragraph()
    heading.paragraph_format.space_before = Pt(14)
    heading.paragraph_format.space_after = Pt(8)
    set_run_font(heading.add_run("预期输出"), "Microsoft YaHei", 14, True)
    outputs = [
        "一份可追溯的资料与证据清单",
        "一张研究问题到实验指标的对应表",
        "一条包含数据准备 模型训练 误差分析 人工确认的研究路线",
        "一份明确区分测试结果 推断与待验证结论的阶段报告",
    ]
    for item in outputs:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.space_after = Pt(6)
        set_run_font(p.add_run(item), "Microsoft YaHei", 11)

    note = doc.add_paragraph()
    note.paragraph_format.space_before = Pt(18)
    set_run_font(note.add_run("测试判定：系统应成功提取标题、章节、表格文本和列表内容，不应把本文中的合成指标标记为真实研究结论。"), "Microsoft YaHei", 10.5, True, "8A5A13")
    doc.save(output)
    return output


def scan_page(lines: list[tuple[str, int, bool]], footer: str, output: Path) -> None:
    width, height = 1654, 2339
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((80, 80, width - 80, height - 80), outline=(34, 80, 73), width=5)
    draw.text((125, 120), "合成测试资料  SCANNED COPY", font=pil_font(30, True), fill=(20, 86, 74))
    y = 245
    for text, size, bold in lines:
        draw.text((125, y), text, font=pil_font(size, bold), fill=(20, 25, 23))
        y += int(size * 2.05)
    draw.text((125, height - 155), footer, font=pil_font(28), fill=(90, 95, 91))
    image.save(output, format="PNG", optimize=True)


def create_scanned_pdf() -> Path:
    page1 = QA / "scan-page-1.png"
    page2 = QA / "scan-page-2.png"
    scan_page([
        ("扫描版 PDF OCR 测试", 76, True),
        ("测试编号 OCR-CN-001", 42, False),
        ("课题名称 小样本工业异常检测研究", 44, True),
        ("在小样本条件下，融合视觉特征与设备日志", 42, False),
        ("可提升异常检测的稳定性。", 42, False),
        ("本页只包含图像，不包含可复制文本。", 42, True),
        ("Expected token RESEARCH-OCR-2026", 38, False),
    ], "第 1 页  需要触发中文与英文 OCR", page1)
    scan_page([
        ("实验批次摘要", 76, True),
        ("正常样本 120 条", 46, False),
        ("异常样本 18 条", 46, False),
        ("验证集准确率数值 91.7", 46, False),
        ("Validation accuracy 91.7%", 42, False),
        ("异常召回率数值 88.9", 46, False),
        ("Anomaly recall 88.9%", 42, False),
        ("以上数字均为合成测试数据。", 42, True),
        ("Batch ID TEST-BATCH-02", 38, False),
    ], "第 2 页  OCR 后应保留数字与百分号", page2)
    output = OUT / "02-扫描版PDF-OCR测试.pdf"
    c = canvas.Canvas(str(output), pagesize=letter)
    width, height = letter
    for page in (page1, page2):
        c.drawImage(ImageReader(str(page)), 0, 0, width=width, height=height, preserveAspectRatio=False, mask="auto")
        c.showPage()
    c.save()
    return output


def register_pdf_font() -> str:
    name = "TestChinese"
    try:
        pdfmetrics.registerFont(TTFont(name, str(FONT_PATH), subfontIndex=0))
    except Exception:
        fallback = Path(r"C:\Windows\Fonts\simhei.ttf")
        pdfmetrics.registerFont(TTFont(name, str(fallback)))
    return name


def create_text_pdf() -> Path:
    font_name = register_pdf_font()
    output = OUT / "03-普通文本PDF-无需OCR.pdf"
    c = canvas.Canvas(str(output), pagesize=letter)
    width, height = letter
    c.setTitle("普通文本PDF测试")
    c.setFont(font_name, 22)
    c.drawString(58, height - 72, "普通文本 PDF 抽取测试")
    c.setFont(font_name, 11)
    lines = [
        "本文档包含真实文本层，系统应直接抽取内容，不应触发 OCR。",
        "研究问题：多模态融合是否能够改善小样本异常检测的稳定性？",
        "方法：比较图像基线、日志基线和特征级融合模型。",
        "预期：抽取结果应包含 TEST-TEXT-PDF-2026 标记。",
        "注意：本文所有内容均为合成测试数据。",
    ]
    y = height - 120
    for line in lines:
        c.drawString(58, y, line)
        y -= 32
    c.setFont(font_name, 9)
    c.drawRightString(width - 58, 42, "第 1 页")
    c.save()
    return output


def make_noise_image(path: Path, seed: int) -> None:
    rng = random.Random(seed)
    width, height = 2200, 3000
    data = rng.randbytes(width * height * 3)
    image = Image.frombytes("RGB", (width, height), data)
    draw = ImageDraw.Draw(image)
    draw.rectangle((75, 75, 2125, 330), fill=(248, 243, 232))
    draw.text((120, 120), "大文件上传测试  LARGE UPLOAD TEST", font=pil_font(54, True), fill=(6, 71, 63))
    image.save(path, "JPEG", quality=96, optimize=False)


def create_large_pdf() -> Path:
    output = OUT / "07-超过4MB上传测试.pdf"
    jpeg_paths = []
    for index in range(2):
        jpeg = QA / f"large-{index + 1}.jpg"
        make_noise_image(jpeg, 20260921 + index)
        jpeg_paths.append(jpeg)
    c = canvas.Canvas(str(output), pagesize=letter, pageCompression=0)
    width, height = letter
    for jpeg in jpeg_paths:
        c.drawImage(str(jpeg), 0, 0, width=width, height=height, preserveAspectRatio=False)
        c.showPage()
    c.save()
    if output.stat().st_size <= 4 * 1024 * 1024:
        raise RuntimeError(f"Large PDF is too small: {output.stat().st_size}")
    return output


def create_unsupported_png() -> Path:
    output = OUT / "09-不支持格式验证.png"
    image = Image.new("RGB", (1200, 720), (248, 243, 232))
    draw = ImageDraw.Draw(image)
    draw.text((80, 90), "不支持格式验证", font=pil_font(70, True), fill=(6, 71, 63))
    draw.text((80, 220), "上传此 PNG 时，系统应提示仅支持 PDF DOCX MD TXT CSV。", font=pil_font(38), fill=(23, 33, 29))
    draw.text((80, 310), "这是预期失败用例，不是系统故障。", font=pil_font(38, True), fill=(153, 96, 16))
    image.save(output, "PNG")
    return output


def write_text_files() -> list[Path]:
    created = []
    project_info = OUT / "00-课题创建信息.txt"
    project_info.write_text(
        "课题名称：基于多模态证据融合的小样本工业异常检测研究\n"
        "学科或领域：计算机视觉与智能制造\n"
        "论文类型：通用研究\n"
        "研究目标：研究在标注样本有限的条件下，融合产品图像、设备日志与工艺参数是否能够提高工业异常检测的召回率、降低误报率，并增强跨设备与跨批次稳定性。预期输出包括可复现实验方案、证据清单、评价指标和人工复核边界。\n"
        "输出语言：中文\n",
        encoding="utf-8-sig",
    )
    created.append(project_info)

    guide = OUT / "00-测试执行清单.md"
    guide.write_text(
        "# 科研工作台全流程测试清单\n\n"
        "> 本目录中的课题、样本、数据和结果均为合成测试数据，只用于功能验收。\n\n"
        "## 一 创建课题\n\n"
        "复制 `00-课题创建信息.txt` 中的五项内容。课题创建成功后，进入资料与证据。\n\n"
        "## 二 文件上传与解析\n\n"
        "1. 上传 `01-研究方案与实验设计.docx`：应成功提取标题、章节、表格和列表。\n"
        "2. 上传 `02-扫描版PDF-OCR测试.pdf`：应显示 OCR 标记，OCR 页数应为 2，并识别中英文与数字。\n"
        "3. 上传 `03-普通文本PDF-无需OCR.pdf`：应直接抽取文本，不应显示 OCR 标记。\n"
        "4. 上传 `04-实验数据摘要.csv`、`05-文献阅读笔记.md`、`06-研究摘要.txt`：均应可上传并解析。\n"
        "5. 上传 `07-超过4MB上传测试.pdf`：应成功上传，证明旧的 4MB 限制已经解除。\n"
        "6. 选择 `08-超过200MB应拒绝.txt`：应在上传前提示超过 200MB，不应进入云端。\n"
        "7. 选择 `09-不支持格式验证.png`：应提示格式不支持。这是预期失败用例。\n\n"
        "## 三 OCR 核对\n\n"
        "将系统抽取内容与 `02-OCR预期识别文本.txt` 比对。允许标点或空格存在轻微差异，但课题名称、样本数量、百分比和英文标记应可读。\n\n"
        "## 四 功能流程\n\n"
        "依次测试资料与证据、研究路线、Idea 评估、文献调研、论文蓝图、章节写作、投稿审查和导出。生成内容必须保留“合成测试数据”的边界，不得把测试指标写成真实研究结论。\n\n"
        "## 五 修改密码\n\n"
        "进入系统设置，先用错误的当前密码验证失败提示，再使用正确当前密码和一个自行设置的合规新密码完成修改。新密码应为 8 至 12 位，并同时包含字母、数字和特殊字符。修改成功后应自动退出，随后用新密码重新登录。不要把实际密码写入本目录。\n",
        encoding="utf-8-sig",
    )
    created.append(guide)

    ocr_expected = OUT / "02-OCR预期识别文本.txt"
    ocr_expected.write_text(
        "扫描版 PDF OCR 测试\n"
        "测试编号 OCR-CN-001\n"
        "课题名称 小样本工业异常检测研究\n"
        "在小样本条件下，融合视觉特征与设备日志可提升异常检测的稳定性。\n"
        "本页只包含图像，不包含可复制文本。\n"
        "Expected token RESEARCH-OCR-2026\n"
        "实验批次摘要\n"
        "正常样本 120 条\n"
        "异常样本 18 条\n"
        "验证集准确率数值 91.7\n"
        "Validation accuracy 91.7%\n"
        "异常召回率数值 88.9\n"
        "Anomaly recall 88.9%\n"
        "Batch ID TEST-BATCH-02\n",
        encoding="utf-8-sig",
    )
    created.append(ocr_expected)

    csv_path = OUT / "04-实验数据摘要.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["批次", "设备", "样本类型", "样本数", "准确率", "召回率", "备注"])
        writer.writerows([
            ["B01", "设备A", "正常", 120, "98.3%", "97.5%", "合成测试数据"],
            ["B01", "设备A", "异常", 18, "91.7%", "88.9%", "合成测试数据"],
            ["B02", "设备B", "正常", 110, "97.3%", "96.4%", "跨设备验证"],
            ["B02", "设备B", "异常", 20, "90.0%", "85.0%", "需要误差分析"],
        ])
    created.append(csv_path)

    notes = OUT / "05-文献阅读笔记.md"
    notes.write_text(
        "# 小样本工业异常检测文献阅读笔记\n\n"
        "## 研究问题\n\n"
        "异常样本稀缺时，单一视觉模型容易受到光照、设备和批次变化影响。\n\n"
        "## 待验证判断\n\n"
        "- 图像与设备日志可能提供互补证据。\n"
        "- 跨批次拆分比随机拆分更能反映真实泛化能力。\n"
        "- 指标不能只看准确率，还应报告异常召回率、误报率和波动范围。\n\n"
        "## 证据边界\n\n"
        "本笔记为合成测试材料，不对应真实论文，不可作为外部文献证据。\n",
        encoding="utf-8-sig",
    )
    created.append(notes)

    abstract = OUT / "06-研究摘要.txt"
    abstract.write_text(
        "研究摘要\n\n"
        "本测试研究面向小样本工业异常检测，比较图像单模态、设备日志单模态与多模态融合方法。测试数据假设训练集包含 420 条正常样本和 48 条异常样本，验证集包含 120 条正常样本和 18 条异常样本。主要评价指标包括准确率、异常召回率、F1 值、误报率与跨批次稳定性。所有数字均为合成测试数据，结论需要通过真实实验验证。\n",
        encoding="utf-8-sig",
    )
    created.append(abstract)
    return created


def create_over_limit_file() -> Path:
    output = OUT / "08-超过200MB应拒绝.txt"
    header = "此文件用于验证 200MB 客户端上限，选择后应被拒绝，不应上传。\n".encode("utf-8")
    with output.open("wb") as handle:
        handle.write(header)
        handle.truncate(201 * 1024 * 1024)
    return output


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(paths: list[Path]) -> Path:
    manifest = OUT / "manifest.json"
    entries = []
    for path in sorted(set(paths), key=lambda item: item.name):
        entries.append({"name": path.name, "size": path.stat().st_size, "sha256": sha256(path)})
    manifest.write_text(json.dumps({"purpose": "科研工作台功能验收", "synthetic": True, "files": entries}, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    created = []
    created.extend(write_text_files())
    created.append(create_docx())
    created.append(create_scanned_pdf())
    created.append(create_text_pdf())
    created.append(create_large_pdf())
    created.append(create_over_limit_file())
    created.append(create_unsupported_png())
    manifest = write_manifest(created)
    print(json.dumps({
        "output": str(OUT),
        "manifest": str(manifest),
        "files": [{"name": path.name, "size": path.stat().st_size} for path in sorted(created, key=lambda item: item.name)],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
