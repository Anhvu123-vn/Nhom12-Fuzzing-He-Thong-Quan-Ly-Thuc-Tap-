#!/usr/bin/env python3
"""Sinh payload cho từng lỗi (BUG-01..07), chạy bản buggy và bản fixed với ASan/UBSan/LSan."""
import sys
from pathlib import Path
from common import *

EVI = ROOT / "out" / "evidence"; EVI.mkdir(parents=True, exist_ok=True)
CASES = {
  "BUG-01_overflow_student_id": make_payload(student_id=b"A"*64),
  "BUG-02_overflow_magic_status": make_payload(status=MAGIC_STATUS, student_id=b"SV001\x00", extra=b"B"*40),
  "BUG-03_null_deref_unlock":   make_payload(code_a=MAGIC_A, code_b=MAGIC_B),
  "BUG-05_double_free_close_session": make_payload(status=MAGIC_STATUS, student_id=b"SV001\x00"),
  "BUG-06_uaf_release_buffer":  make_payload(status=0xDEAD, student_id=b"SV001\x00"),
  "BUG-07_int_overflow_telemetry": make_payload(sent=1_500_000_000, queued=1_000_000_000),
}
def first_lines(s, n=14):
    return "\n".join(s.strip().splitlines()[:n])

out = []
for name, p in CASES.items():
    (EVI / f"{name}.bin").write_bytes(p)
    for tag, binf in (("buggy", BUILD/"parser_asan"), ("fixed", BUILD/"fixed_asan")):
        rc, err, to = run(binf, p)
        (EVI / f"{name}.{tag}.log").write_text(err)
        summ = [l for l in err.splitlines() if "SUMMARY" in l or "runtime error" in l]
        out.append(f"{name:36s} {tag:5s} rc={rc:<3d} {'|'.join(summ)[:150]}")
print("\n".join(out))
(EVI / "evidence_summary.txt").write_text("\n".join(out) + "\n")
