#!/usr/bin/env python3
"""
whitebox_fuzz.py
White-box / Concolic fuzzing cho internship_parser.
Dùng Z3 giải ngược các điều kiện magic → sinh payload đạt nhánh mục tiêu chỉ trong 1 lần.
"""

import os
import sys
import time
import struct
import subprocess
import tempfile
from pathlib import Path

try:
    from z3 import BitVec, Solver, sat, BitVecVal
except ImportError:
    print("[!] Cần cài z3-solver: pip install z3-solver")
    sys.exit(1)

TARGET = Path(__file__).resolve().parent.parent / "targets" / "internship_parser"
OUT_DIR = Path(__file__).resolve().parent.parent / "out" / "evidence"

MAGIC_STATUS = 0x494E54
MAGIC_A, MAGIC_B = 7421, 3390

def make_payload(status=0, code_a=0, code_b=0, sent=0, queued=0,
                 student_id=b"SV001", extra=b""):
    id_len = min(len(student_id), 255)
    buf = struct.pack("<IiiiiB", status, code_a, code_b, sent, queued, id_len)
    buf += student_id[:id_len]
    buf += extra
    return buf

def run_target(payload: bytes, timeout=2.0):
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(payload)
        fname = f.name
    try:
        r = subprocess.run(
            [str(TARGET), fname],
            capture_output=True,
            timeout=timeout,
        )
        crashed = (
            r.returncode != 0
            or b"AddressSanitizer" in r.stderr
            or b"SEGV" in r.stderr
            or b"runtime error" in r.stderr
        )
        return crashed, r.returncode, r.stderr.decode(errors="replace")
    except subprocess.TimeoutExpired:
        return True, -1, "TIMEOUT"
    finally:
        os.unlink(fname)

def solve_magic_status():
    """Z3 giải status_code == MAGIC_STATUS."""
    status = BitVec("status", 32)
    s = Solver()
    s.add(status == MAGIC_STATUS)
    if s.check() == sat:
        m = s.model()
        return m[status].as_long()
    return None

def solve_unlock_pair():
    """Z3 giải code_a == 7421 && code_b == 3390."""
    a = BitVec("code_a", 32)
    b = BitVec("code_b", 32)
    s = Solver()
    s.add(a == MAGIC_A)
    s.add(b == MAGIC_B)
    if s.check() == sat:
        m = s.model()
        # Xử lý số âm (signed)
        va = m[a].as_signed_long()
        vb = m[b].as_signed_long()
        return va, vb
    return None, None

def solve_overflow_id():
    """Sinh student_id dài hơn 16 byte để kích hoạt buffer overflow."""
    # Không cần Z3 – chỉ cần id_len > 16
    return b"A" * 64

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not TARGET.exists():
        print(f"[!] Binary chưa tồn tại: {TARGET}")
        print("    Hãy chạy: make -C targets")
        sys.exit(1)

    log_lines = ["=== White-box (Z3) Fuzzing – internship_parser ===\n"]

    # ---- 1. Magic status ----
    print("[*] Solving MAGIC_STATUS with Z3 ...")
    t0 = time.time()
    status_val = solve_magic_status()
    t1 = time.time()
    print(f"    Solved: status = 0x{status_val:08X} in {(t1-t0)*1000:.2f} ms")
    log_lines.append(f"Magic status Z3: value=0x{status_val:08X}, time_ms={(t1-t0)*1000:.2f}\n")

    payload = make_payload(status=status_val, extra=b"B" * 40)
    pfile = OUT_DIR / "whitebox_magic_status.bin"
    pfile.write_bytes(payload)
    crashed, rc, err = run_target(payload)
    log_lines.append(f"  Run result: crashed={crashed}, rc={rc}\n")
    if "AddressSanitizer" in err or "stack-buffer-overflow" in err:
        log_lines.append("  ASan confirmed stack-buffer-overflow (CWE-120)\n")
    print(f"    Crashed: {crashed}")

    # ---- 2. Unlock pair ----
    print("[*] Solving unlock pair (7421, 3390) with Z3 ...")
    t0 = time.time()
    a, b = solve_unlock_pair()
    t1 = time.time()
    print(f"    Solved: code_a={a}, code_b={b} in {(t1-t0)*1000:.2f} ms")
    log_lines.append(f"Unlock pair Z3: a={a}, b={b}, time_ms={(t1-t0)*1000:.2f}\n")

    payload = make_payload(code_a=a, code_b=b)
    pfile = OUT_DIR / "whitebox_unlock.bin"
    pfile.write_bytes(payload)
    crashed, rc, err = run_target(payload)
    log_lines.append(f"  Run result: crashed={crashed}, rc={rc}\n")
    if "AddressSanitizer" in err or "SEGV" in err or "null" in err.lower():
        log_lines.append("  ASan/UBSan confirmed NULL-dereference on magic pair\n")
    print(f"    Crashed: {crashed}")

    # ---- 3. Long student_id (overflow) ----
    print("[*] Generating long student_id for buffer overflow ...")
    long_id = solve_overflow_id()
    payload = make_payload(student_id=long_id)
    pfile = OUT_DIR / "whitebox_overflow_id.bin"
    pfile.write_bytes(payload)
    crashed, rc, err = run_target(payload)
    log_lines.append(f"Long ID overflow: crashed={crashed}, rc={rc}\n")
    if "AddressSanitizer" in err or "stack-buffer-overflow" in err:
        log_lines.append("  ASan confirmed stack-buffer-overflow (CWE-120)\n")
    print(f"    Crashed: {crashed}")

    # ---- 4. Integer overflow telemetry ----
    print("[*] Crafting telemetry overflow (sent + queued > 2e9) ...")
    payload = make_payload(sent=1_500_000_000, queued=1_000_000_000)
    pfile = OUT_DIR / "whitebox_telemetry.bin"
    pfile.write_bytes(payload)
    crashed, rc, err = run_target(payload)
    log_lines.append(f"Telemetry overflow: crashed={crashed}, rc={rc}\n")
    print(f"    rc={rc}")

    log_path = OUT_DIR / "whitebox_run_log.txt"
    log_path.write_text("".join(log_lines))
    print(f"\n[+] Log saved: {log_path}")
    print("[+] Tất cả payload đã ghi vào out/evidence/")

if __name__ == "__main__":
    main()
