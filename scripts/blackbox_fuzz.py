#!/usr/bin/env python3
"""
blackbox_fuzz.py
Black-box fuzzing cho internship_parser (random mutation).
Đo số lần thử / thời gian để tìm các nhánh mục tiêu (magic status, unlock pair).
"""

import os
import sys
import time
import random
import struct
import subprocess
import tempfile
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "targets" / "internship_parser"
OUT_DIR = Path(__file__).resolve().parent.parent / "out" / "evidence"

MAGIC_STATUS = 0x494E54          # 'INT'
MAGIC_A, MAGIC_B = 7421, 3390

def make_payload(status=0, code_a=0, code_b=0, sent=0, queued=0,
                 student_id=b"SV001", extra=b""):
    """Tạo payload binary đúng định dạng parser."""
    id_len = min(len(student_id), 255)
    # removed bad pack
    # struct.pack format corrected
    buf = struct.pack("<IiiiiB", status, code_a, code_b, sent, queued, id_len)
    buf += student_id[:id_len]
    buf += extra
    return buf

def run_target(payload: bytes, timeout=2.0):
    """Chạy binary, trả về (crashed, returncode, stderr)."""
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(payload)
        fname = f.name
    try:
        r = subprocess.run(
            [str(TARGET), fname],
            capture_output=True,
            timeout=timeout,
        )
        crashed = r.returncode != 0 or b"AddressSanitizer" in r.stderr or b"SEGV" in r.stderr
        return crashed, r.returncode, r.stderr.decode(errors="replace")
    except subprocess.TimeoutExpired:
        return True, -1, "TIMEOUT"
    finally:
        os.unlink(fname)

def blackbox_search_magic_status(max_tries=500_000, seed=42):
    """Tìm status_code == MAGIC_STATUS bằng random."""
    random.seed(seed)
    start = time.time()
    for i in range(1, max_tries + 1):
        status = random.randint(0, 0xFFFFFFFF)
        payload = make_payload(status=status, extra=b"A" * 32)
        crashed, _, _ = run_target(payload)
        if crashed or status == MAGIC_STATUS:
            # Xác nhận đúng magic
            if status == MAGIC_STATUS:
                elapsed = time.time() - start
                return i, elapsed, True
    elapsed = time.time() - start
    return max_tries, elapsed, False

def blackbox_search_unlock(max_tries=2_000_000, seed=1):
    """Tìm cặp (code_a, code_b) == (7421, 3390) – không gian 2^64, gần như bất khả."""
    random.seed(seed)
    start = time.time()
    for i in range(1, max_tries + 1):
        a = random.randint(-2**31, 2**31 - 1)
        b = random.randint(-2**31, 2**31 - 1)
        if a == MAGIC_A and b == MAGIC_B:
            elapsed = time.time() - start
            return i, elapsed, True
        # Thỉnh thoảng chạy thật để đo tốc độ
        if i % 100_000 == 0:
            payload = make_payload(code_a=a, code_b=b)
            run_target(payload)
    elapsed = time.time() - start
    return max_tries, elapsed, False

def blackbox_overflow_id(max_tries=10_000, seed=7):
    """Tạo student_id dài → buffer overflow (dễ tìm)."""
    random.seed(seed)
    start = time.time()
    for i in range(1, max_tries + 1):
        long_id = b"A" * random.randint(20, 200)
        payload = make_payload(student_id=long_id)
        crashed, rc, err = run_target(payload)
        if crashed:
            elapsed = time.time() - start
            return i, elapsed, True, payload
    elapsed = time.time() - start
    return max_tries, elapsed, False, None

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not TARGET.exists():
        print(f"[!] Binary chưa tồn tại: {TARGET}")
        print("    Hãy chạy: make -C targets")
        sys.exit(1)

    log_path = OUT_DIR / "blackbox_run_log.txt"
    lines = []
    lines.append("=== Black-box Fuzzing – internship_parser ===\n")

    # 1. Buffer overflow qua student_id dài (dễ)
    print("[*] Searching buffer-overflow via long student_id ...")
    tries, t, found, sample = blackbox_overflow_id()
    msg = f"Buffer-overflow (long ID): tries={tries}, time={t:.3f}s, found={found}"
    print(msg)
    lines.append(msg + "\n")
    if sample:
        sample_path = OUT_DIR / "overflow_id_payload.bin"
        sample_path.write_bytes(sample)
        lines.append(f"  Sample payload saved: {sample_path}\n")

    # 2. Magic status (không gian 2^32)
    print("[*] Searching MAGIC_STATUS = 0x494E54 (random, max 500k) ...")
    tries, t, found = blackbox_search_magic_status(max_tries=200_000)
    msg = f"Magic status: tries={tries}, time={t:.3f}s, found={found}"
    print(msg)
    lines.append(msg + "\n")
    if not found:
        lines.append("  → Không tìm thấy trong ngân sách; kỳ vọng ~2^32 lần thử\n")

    # 3. Unlock pair (cực khó)
    print("[*] Searching unlock pair (7421, 3390) – max 500k (minh họa bất khả) ...")
    tries, t, found = blackbox_search_unlock(max_tries=500_000, seed=1)
    msg = f"Unlock pair: tries={tries}, time={t:.3f}s, found={found}"
    print(msg)
    lines.append(msg + "\n")
    lines.append("  → Xác suất 1/2^64, black-box thực tế bất khả thi\n")

    log_path.write_text("".join(lines))
    print(f"\n[+] Log saved: {log_path}")

if __name__ == "__main__":
    main()
