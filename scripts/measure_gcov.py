#!/usr/bin/env python3
"""Đo độ phủ dòng/nhánh bằng gcov cho tập corpus của từng campaign (build không sanitizer)."""
import subprocess, re, json, glob, os
from pathlib import Path
from common import ROOT, BUILD, make_payload, run

SRC = ROOT / "targets" / "internship_parser.c"
GB = BUILD / "parser_gcov"
subprocess.run(["gcc", "-g", "-O0", "--coverage", "-o", str(GB), str(SRC), str(ROOT/"scripts"/"gcov_shim.c")], check=True)

def measure(files):
    for g in glob.glob(str(BUILD / "*.gcda")): os.unlink(g)
    for f in files:
        run(GB, Path(f).read_bytes() if isinstance(f, (str, Path)) else f, timeout=2.0)
    r = subprocess.run(["gcov", "-b", "parser_gcov-internship_parser.gcda"], capture_output=True, text=True, cwd=BUILD)
    txt = r.stdout
    blk = txt.split("File '")
    sect = [b for b in blk if "internship_parser.c'" in b.split("\n")[0]][0]
    lines = re.search(r"Lines executed:([\d.]+)% of (\d+)", sect)
    br = re.search(r"Branches executed:([\d.]+)% of (\d+)", sect)
    taken = re.search(r"Taken at least once:([\d.]+)% of (\d+)", sect)
    return {"line_pct": float(lines.group(1)), "lines": int(lines.group(2)),
            "branch_pct": float(br.group(1)), "branches": int(br.group(2)),
            "taken_pct": float(taken.group(1))}

res = {"baseline_benign_seed": measure([make_payload()])}
for mode in ("blackbox", "bounded", "whitebox"):
    for seed in (1, 2, 3):
        d = ROOT / "out" / "fuzz" / f"{mode}_s{seed}" / "corpus"
        if d.exists():
            res[f"{mode}_s{seed}"] = measure(sorted(d.glob("*.bin")))
# bộ payload chứng cứ BUG-01..07
ev = sorted((ROOT / "out" / "evidence").glob("BUG-0*.bin"))
res["evidence_payloads"] = measure(ev)
(ROOT / "out" / "gcov_summary.json").write_text(json.dumps(res, indent=1))
for k, v in res.items(): print(f"{k:24s} line {v['line_pct']:5.1f}% / branch-taken {v['taken_pct']:5.1f}%")
