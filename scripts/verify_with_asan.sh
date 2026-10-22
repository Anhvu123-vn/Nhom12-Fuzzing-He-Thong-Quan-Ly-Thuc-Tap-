#!/usr/bin/env bash
# verify_with_asan.sh
# Biên dịch bản buggy với ASan rồi chạy một payload để xác nhận crash thật.
# Cách dùng:
#   ./verify_with_asan.sh [payload.bin]
# Nếu không truyền payload, script tự tạo payload gây overflow ID.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/targets/internship_parser.c"
BIN="$ROOT/targets/internship_parser_asan"
EVIDENCE="$ROOT/out/evidence"
mkdir -p "$EVIDENCE"

echo "[*] Compiling with AddressSanitizer + UBSan ..."
gcc -g -O0 -fsanitize=address,undefined -o "$BIN" "$SRC"

PAYLOAD="${1:-}"
if [[ -z "$PAYLOAD" ]]; then
    PAYLOAD="$EVIDENCE/auto_overflow_id.bin"
    python3 -c '
import struct, sys
path = sys.argv[1]
student_id = b"A" * 64
id_len = len(student_id)
buf = struct.pack("<IiiiiB", 0, 0, 0, 0, 0, id_len) + student_id
open(path, "wb").write(buf)
print(f"Created {path} ({len(buf)} bytes)")
' "$PAYLOAD"
fi

echo "[*] Running: $BIN $PAYLOAD"
echo "----- ASan output -----"
set +e
"$BIN" "$PAYLOAD" 2> "$EVIDENCE/asan_crash_log.txt"
RC=$?
set -e
cat "$EVIDENCE/asan_crash_log.txt"
echo "----- end (rc=$RC) -----"
echo "[+] Full log saved to $EVIDENCE/asan_crash_log.txt"

if grep -qE "AddressSanitizer|stack-buffer-overflow|heap-buffer-overflow|SEGV|runtime error|ERROR:" \
        "$EVIDENCE/asan_crash_log.txt"; then
    echo "[+] ASan CONFIRMED a real memory error (CWE-120 or related)."
    exit 0
else
    echo "[-] No ASan error detected. Check payload or binary."
    exit 1
fi
