#!/usr/bin/env python3
"""Chạy bản fixed (ASan+UBSan) trên mọi payload gây lỗi/đạt coverage mới của các campaign và các payload BUG-xx."""
import glob
from pathlib import Path
from common import ROOT, BUILD, run
files = sorted(glob.glob(str(ROOT/"out"/"fuzz"/"*"/"finding_*.bin"))) + sorted(glob.glob(str(ROOT/"out"/"fuzz"/"*"/"corpus"/"*.bin"))) \
      + sorted(glob.glob(str(ROOT/"out"/"evidence"/"BUG-0*.bin")))
bad_fixed, bad_buggy = 0, 0
for f in files:
    p = Path(f).read_bytes()
    rc, err, _ = run(BUILD/"fixed_asan", p)
    if rc != 0 or "ERROR: AddressSanitizer" in err or "runtime error" in err: bad_fixed += 1
    rc2, err2, _ = run(BUILD/"parser_asan", p)
    if rc2 != 0 or "ERROR: AddressSanitizer" in err2 or "runtime error" in err2: bad_buggy += 1
msg = f"payload: {len(files)} | bản buggy lỗi/crash: {bad_buggy} | bản fixed lỗi/crash: {bad_fixed}"
print(msg); (ROOT/"out"/"evidence"/"fixed_regression.txt").write_text(msg+"\n")
