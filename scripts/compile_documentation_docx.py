"""
compile_documentation_docx.py
Compiles README.md and all 10 high-resolution generated images into a professional,
publication-grade Microsoft Word (.docx) document and matching PDF.
"""

import os
import re
import sys
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn
from PIL import Image

def set_cell_background(cell, fill_hex):
    """Set background color of a table cell."""
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=120, bottom=120, left=180, right=180):
    """Set cell padding (in dxa: 20 dxa = 1 pt)."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(
        f'<w:tcMar {nsdecls("w")}>'
        f'<w:top w:w="{top}" w:type="dxa"/>'
        f'<w:bottom w:w="{bottom}" w:type="dxa"/>'
        f'<w:left w:w="{left}" w:type="dxa"/>'
        f'<w:right w:w="{right}" w:type="dxa"/>'
        f'</w:tcMar>'
    )
    tcPr.append(tcMar)

def set_table_borders(table, color="CBD5E1", sz="4", val="single"):
    """Set clean subtle borders on a table."""
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'<w:top w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'<w:bottom w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'<w:insideH w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'<w:insideV w:val="none"/>'
        f'<w:left w:val="none"/>'
        f'<w:right w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(borders)

def build_docx_report(readme_path, output_docx_path):
    print(f"Reading {readme_path}...")
    with open(readme_path, "r", encoding="utf-8") as f:
        readme_content = f.read()

    doc = docx.Document()

    # Page Setup: Standard Letter, 0.85 inch margins for professional report
    for section in doc.sections:
        section.top_margin = Inches(0.85)
        section.bottom_margin = Inches(0.85)
        section.left_margin = Inches(0.85)
        section.right_margin = Inches(0.85)
        
        # Configure Header & Footer
        header = section.header
        hp = header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hrun = hp.add_run("AeroFS: Operating System Storage & CoW Subsystem")
        hrun.font.name = "Calibri"
        hrun.font.size = Pt(8.5)
        hrun.font.color.rgb = RGBColor(148, 163, 184) # slate-400

        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        frun = fp.add_run("BITE303L Operating Systems • Modules 6 & 7 Comprehensive Verification • 164/164 Tests Passed")
        frun.font.name = "Calibri"
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = RGBColor(148, 163, 184)

    # Set Default Normal Style Font
    style_normal = doc.styles["Normal"]
    font = style_normal.font
    font.name = "Calibri"
    font.size = Pt(10.5)
    font.color.rgb = RGBColor(30, 41, 59) # slate-800

    lines = readme_content.split("\n")
    i = 0
    n = len(lines)

    in_code_block = False
    code_lines = []
    
    in_table = False
    table_raw_rows = []

    in_blockquote = False
    blockquote_lines = []

    def flush_table():
        nonlocal in_table, table_raw_rows
        if not table_raw_rows:
            in_table = False
            return
        
        # Parse table rows
        rows_data = []
        for r in table_raw_rows:
            # strip leading/trailing pipe
            line_str = r.strip()
            if line_str.startswith("|"):
                line_str = line_str[1:]
            if line_str.endswith("|"):
                line_str = line_str[:-1]
            cols = [c.strip() for c in line_str.split("|")]
            # ignore separator rows like |:---|:---|
            if all(re.match(r'^:?-+:?$', c) for c in cols if c):
                continue
            rows_data.append(cols)
        
        table_raw_rows = []
        in_table = False

        if not rows_data:
            return

        num_cols = max(len(r) for r in rows_data)
        # normalize row lengths
        for r in rows_data:
            while len(r) < num_cols:
                r.append("")

        table = doc.add_table(rows=len(rows_data), cols=num_cols)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        set_table_borders(table, color="CBD5E1")

        for row_idx, row in enumerate(rows_data):
            tr = table.rows[row_idx]
            is_header = (row_idx == 0)
            
            for col_idx, text in enumerate(row):
                cell = tr.cells[col_idx]
                set_cell_margins(cell, top=100, bottom=100, left=140, right=140)
                cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER

                p = cell.paragraphs[0]
                p.paragraph_format.space_before = Pt(0)
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.1

                run = p.add_run(clean_markdown_text(text))
                run.font.name = "Calibri"

                if is_header:
                    set_cell_background(cell, "1E3A8A") # Navy Blue Header
                    run.bold = True
                    run.font.size = Pt(9.5)
                    run.font.color.rgb = RGBColor(255, 255, 255) # White text
                else:
                    run.font.size = Pt(9)
                    # Alternate row shading
                    if row_idx % 2 == 1:
                        set_cell_background(cell, "FFFFFF")
                    else:
                        set_cell_background(cell, "F8FAFC") # Soft Slate
                    
                    # Special color for status
                    if text.strip() in ["PASSED", "`PASSED`"]:
                        run.bold = True
                        run.font.color.rgb = RGBColor(16, 185, 129) # Emerald Green
                    elif "FAILED" in text:
                        run.bold = True
                        run.font.color.rgb = RGBColor(239, 68, 68) # Red
                    else:
                        run.font.color.rgb = RGBColor(30, 41, 59)

        # Space after table
        after_p = doc.add_paragraph()
        after_p.paragraph_format.space_before = Pt(4)
        after_p.paragraph_format.space_after = Pt(6)

    def flush_blockquote():
        nonlocal in_blockquote, blockquote_lines
        if not blockquote_lines:
            in_blockquote = False
            return
        
        full_text = " ".join(blockquote_lines)
        blockquote_lines = []
        in_blockquote = False

        # Add styled callout box (1x1 table)
        tbl = doc.add_table(rows=1, cols=1)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = tbl.cell(0, 0)
        set_cell_background(cell, "F0F9FF") # Light cyan/blue background
        set_cell_margins(cell, top=140, bottom=140, left=200, right=200)

        # Custom left border only for callout
        tcPr = cell._tc.get_or_add_tcPr()
        borders = parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'<w:left w:val="single" w:sz="24" w:space="0" w:color="0284C7"/>'
            f'<w:top w:val="none"/>'
            f'<w:bottom w:val="none"/>'
            f'<w:right w:val="none"/>'
            f'</w:tcBorders>'
        )
        tcPr.append(borders)

        cp = cell.paragraphs[0]
        cp.paragraph_format.space_before = Pt(0)
        cp.paragraph_format.space_after = Pt(0)
        crun = cp.add_run(clean_markdown_text(full_text))
        crun.font.name = "Calibri"
        crun.font.size = Pt(10)
        crun.font.italic = True
        crun.font.color.rgb = RGBColor(3, 105, 161) # ocean-700

        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    def flush_code_block():
        nonlocal in_code_block, code_lines
        if not code_lines:
            in_code_block = False
            return
        
        text = "\n".join(code_lines)
        code_lines = []
        in_code_block = False

        # Add styled code box (1x1 table)
        tbl = doc.add_table(rows=1, cols=1)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = tbl.cell(0, 0)
        set_cell_background(cell, "0F172A") # Dark slate background
        set_cell_margins(cell, top=120, bottom=120, left=180, right=180)

        # Subtle border
        tcPr = cell._tc.get_or_add_tcPr()
        borders = parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'<w:left w:val="single" w:sz="6" w:space="0" w:color="334155"/>'
            f'<w:top w:val="single" w:sz="6" w:space="0" w:color="334155"/>'
            f'<w:bottom w:val="single" w:sz="6" w:space="0" w:color="334155"/>'
            f'<w:right w:val="single" w:sz="6" w:space="0" w:color="334155"/>'
            f'</w:tcBorders>'
        )
        tcPr.append(borders)

        cp = cell.paragraphs[0]
        cp.paragraph_format.space_before = Pt(0)
        cp.paragraph_format.space_after = Pt(0)
        crun = cp.add_run(text)
        crun.font.name = "Consolas"
        crun.font.size = Pt(8.5)
        crun.font.color.rgb = RGBColor(226, 232, 240) # light slate

        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    def clean_markdown_text(text):
        """Clean markdown markers like **, *, `, $, links."""
        t = text
        # Clean links [text](url) -> text
        t = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', t)
        # Clean inline math $...$ -> ...
        t = re.sub(r'\$([^\$]+)\$', r'\1', t)
        # Clean bold **text** -> text
        t = re.sub(r'\*\*([^\*]+)\*\*', r'\1', t)
        # Clean code `code` -> code
        t = re.sub(r'`([^`]+)`', r'\1', t)
        return t

    while i < n:
        line = lines[i]

        # 1. Code blocks
        if line.strip().startswith("```"):
            if in_code_block:
                flush_code_block()
            else:
                if in_table:
                    flush_table()
                if in_blockquote:
                    flush_blockquote()
                in_code_block = True
            i += 1
            continue

        if in_code_block:
            code_lines.append(line)
            i += 1
            continue

        # 2. Tables
        if line.strip().startswith("|") and line.strip().endswith("|"):
            if in_blockquote:
                flush_blockquote()
            in_table = True
            table_raw_rows.append(line)
            i += 1
            continue
        elif in_table:
            flush_table()

        # 3. Blockquotes
        if line.strip().startswith(">"):
            in_blockquote = True
            cleaned_bq = re.sub(r'^>\s*', '', line.strip())
            blockquote_lines.append(cleaned_bq)
            i += 1
            continue
        elif in_blockquote:
            flush_blockquote()

        stripped = line.strip()

        # 4. Empty lines
        if not stripped:
            i += 1
            continue

        # 5. Badges / HTML comments / Horizonal rules
        if stripped.startswith("[![") or stripped.startswith("<!--") or stripped == "---":
            i += 1
            continue

        # 6. Images: ![alt](path)
        img_match = re.match(r'!\[([^\]]*)\]\(([^\)]+)\)', stripped)
        if img_match:
            caption = img_match.group(1)
            img_rel_path = img_match.group(2)
            
            # Resolve image path
            img_abs_path = os.path.join(os.path.dirname(readme_path), img_rel_path)
            if not os.path.exists(img_abs_path):
                # Try images/ direct
                img_abs_path = os.path.join(os.path.dirname(readme_path), "images", os.path.basename(img_rel_path))
            
            if os.path.exists(img_abs_path):
                print(f"Embedding image: {img_abs_path}")
                try:
                    # Centered Image paragraph
                    ip = doc.add_paragraph()
                    ip.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    ip.paragraph_format.space_before = Pt(8)
                    ip.paragraph_format.space_after = Pt(2)
                    irun = ip.add_run()
                    # Scale image nicely (6.2 inches max width)
                    irun.add_picture(img_abs_path, width=Inches(6.2))

                    # Caption paragraph
                    # check if next line is caption (*Figure...*)
                    figure_caption = caption
                    if i + 1 < n and lines[i+1].strip().startswith("*Figure"):
                        figure_caption = lines[i+1].strip().strip("*")
                        i += 1

                    cp = doc.add_paragraph()
                    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    cp.paragraph_format.space_before = Pt(2)
                    cp.paragraph_format.space_after = Pt(10)
                    crun = cp.add_run(figure_caption)
                    crun.font.name = "Calibri"
                    crun.font.size = Pt(8.5)
                    crun.font.italic = True
                    crun.font.color.rgb = RGBColor(100, 116, 139) # slate-500
                except Exception as e:
                    print(f"Warning: Failed to insert image {img_abs_path}: {e}")
            else:
                print(f"Warning: Image file not found: {img_abs_path}")

            i += 1
            continue

        # 7. Headings
        if stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            heading_text = clean_markdown_text(stripped.lstrip("#").strip())

            # Section page breaks before top-level sections (## 1., ## 2., etc)
            if level == 2 and re.match(r'^[0-9]\.', heading_text):
                doc.add_page_break()

            hp = doc.add_paragraph()
            hrun = hp.add_run(heading_text)
            hrun.bold = True
            hrun.font.name = "Calibri"

            if level == 1:
                hp.paragraph_format.space_before = Pt(14)
                hp.paragraph_format.space_after = Pt(6)
                hrun.font.size = Pt(22)
                hrun.font.color.rgb = RGBColor(15, 23, 42) # slate-900
            elif level == 2:
                hp.paragraph_format.space_before = Pt(16)
                hp.paragraph_format.space_after = Pt(5)
                hrun.font.size = Pt(15)
                hrun.font.color.rgb = RGBColor(30, 58, 138) # blue-900
            elif level == 3:
                hp.paragraph_format.space_before = Pt(12)
                hp.paragraph_format.space_after = Pt(4)
                hrun.font.size = Pt(12.5)
                hrun.font.color.rgb = RGBColor(3, 105, 161) # ocean-700
            elif level == 4:
                hp.paragraph_format.space_before = Pt(10)
                hp.paragraph_format.space_after = Pt(3)
                hrun.font.size = Pt(11)
                hrun.font.color.rgb = RGBColor(51, 65, 85) # slate-700
            else:
                hp.paragraph_format.space_before = Pt(8)
                hp.paragraph_format.space_after = Pt(2)
                hrun.font.size = Pt(10.5)
                hrun.font.color.rgb = RGBColor(71, 85, 105) # slate-600
            
            i += 1
            continue

        # 8. Bullet / Numbered Lists
        list_match = re.match(r'^([\*\-]|([0-9]+\.))\s+(.*)$', stripped)
        if list_match:
            marker = list_match.group(1)
            content = list_match.group(3)

            p = doc.add_paragraph(style='List Bullet' if marker in ['*', '-'] else 'List Number')
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.15

            # Handle bold prefix e.g. * **Title:** content
            bold_prefix_match = re.match(r'^\*\*([^\*]+)\*\*:\s*(.*)$', content)
            if bold_prefix_match:
                prefix = bold_prefix_match.group(1)
                rest = bold_prefix_match.group(2)

                r_prefix = p.add_run(prefix + ": ")
                r_prefix.bold = True
                r_prefix.font.name = "Calibri"
                r_prefix.font.size = Pt(10)
                r_prefix.font.color.rgb = RGBColor(15, 23, 42)

                r_rest = p.add_run(clean_markdown_text(rest))
                r_rest.font.name = "Calibri"
                r_rest.font.size = Pt(10)
                r_rest.font.color.rgb = RGBColor(51, 65, 85)
            else:
                r = p.add_run(clean_markdown_text(content))
                r.font.name = "Calibri"
                r.font.size = Pt(10)
                r.font.color.rgb = RGBColor(51, 65, 85)

            i += 1
            continue

        # 9. Standard Paragraphs
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.15

        run = p.add_run(clean_markdown_text(stripped))
        run.font.name = "Calibri"
        run.font.size = Pt(10.5)
        run.font.color.rgb = RGBColor(30, 41, 59)

        i += 1

    # Final flushes
    if in_table:
        flush_table()
    if in_blockquote:
        flush_blockquote()
    if in_code_block:
        flush_code_block()

    print(f"Saving compiled document to {output_docx_path}...")
    doc.save(output_docx_path)
    print("Document successfully compiled and saved!")

if __name__ == "__main__":
    base_dir = "/home/abhishek/Documents/os_project"
    readme_file = os.path.join(base_dir, "README.md")
    output_docx = os.path.join(base_dir, "AeroFS_Documentation.docx")
    build_docx_report(readme_file, output_docx)
