#!/usr/bin/env python3
"""Điền sẵn mục lục (kèm số trang đo từ bản PDF) vào field TOC của docx. Dùng: inject_toc.py in.docx out.docx"""
import sys, re, zipfile, subprocess, shutil, tempfile, os, html
from pathlib import Path
src, dst = sys.argv[1], sys.argv[2]
tmp = Path(tempfile.mkdtemp())
subprocess.run(["python3", "/mnt/skills/public/docx/scripts/office/soffice.py", "--headless", "--convert-to", "pdf", "--outdir", str(tmp), src], capture_output=True)
pdf = tmp / (Path(src).stem + ".pdf")
npages = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout).group(1))
pages = [subprocess.run(["pdftotext", "-f", str(i), "-l", str(i), str(pdf), "-"], capture_output=True, text=True).stdout for i in range(1, npages + 1)]
z = zipfile.ZipFile(src); xml = z.read("word/document.xml").decode("utf8")
heads = []
for m in re.finditer(r'<w:p>(?:(?!</w:p>).)*?<w:pStyle w:val="Heading([12])"/>(?:(?!</w:p>).)*?</w:p>', xml, re.S):
    txt = html.unescape("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", m.group(0))))
    heads.append((int(m.group(1)), txt))
entries, cur = [], 2
for lvl, t in heads:
    pg = None
    for p in range(cur, npages + 1):
        lines = [l.strip() for l in pages[p - 1].splitlines()]
        if t in lines or any(l.startswith(t) for l in lines): pg = p; break
    if pg is None: pg = cur
    cur = pg; entries.append((lvl, t, pg))
def para(lvl, t, pg):
    ind = 0 if lvl == 1 else 360
    b = "<w:b/>" if lvl == 1 else ""
    return (f'<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9071"/></w:tabs>'
            f'<w:spacing w:before="{80 if lvl==1 else 0}" w:after="20" w:line="276" w:lineRule="auto"/><w:ind w:left="{ind}"/></w:pPr>'
            f'<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>{b}<w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">{html.escape(t)}</w:t></w:r>'
            f'<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>{b}<w:sz w:val="24"/></w:rPr><w:tab/><w:t>{pg}</w:t></w:r></w:p>')
toc = "".join(para(*e) for e in entries)
xml = xml.replace(' w:dirty="true"', "")
a = xml.index("<w:sdtContent>") + len("<w:sdtContent>")
first_end = xml.index("</w:p>", a) + 6
xml = xml[:first_end] + toc + xml[first_end:]
zout = zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED)
for it in z.infolist():
    data = z.read(it.filename)
    if it.filename == "word/document.xml": data = xml.encode("utf8")
    zout.writestr(it, data)
zout.close(); shutil.rmtree(tmp)
for e in entries: print(e)
