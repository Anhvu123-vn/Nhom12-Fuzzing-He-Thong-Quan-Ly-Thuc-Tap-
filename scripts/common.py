"""Tiện ích dùng chung: dựng payload nhị phân và chạy target."""
import os, struct, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
MAGIC_STATUS = 0x494E54
MAGIC_A, MAGIC_B = 7421, 3390

def make_payload(status=0, code_a=0, code_b=0, sent=0, queued=0,
                 student_id=b"SV001\x00", extra=b"", id_len=None):
    """Định dạng: u32 status | i32 a | i32 b | i32 sent | i32 queued | u8 id_len | id | extra."""
    if id_len is None:
        id_len = min(len(student_id), 255)
    return struct.pack("<IiiiiB", status, code_a, code_b, sent, queued, id_len) \
        + student_id[:id_len] + extra

def run(binary, payload, env_extra=None, timeout=3.0):
    env = dict(os.environ)
    env["ASAN_OPTIONS"] = "detect_leaks=1:abort_on_error=0:detect_stack_use_after_return=0"
    env["UBSAN_OPTIONS"] = "print_stacktrace=1"
    if env_extra:
        env.update(env_extra)
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(payload); name = f.name
    try:
        r = subprocess.run([str(binary), name], capture_output=True, timeout=timeout, env=env)
        return r.returncode, r.stderr.decode(errors="replace"), False
    except subprocess.TimeoutExpired:
        return -1, "TIMEOUT", True
    finally:
        os.unlink(name)
