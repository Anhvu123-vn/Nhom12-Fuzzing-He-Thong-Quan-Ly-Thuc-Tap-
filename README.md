# Nhóm 12 – Fuzzing white-box cho Hệ thống Quản lý Thực tập Sinh viên (CSE703093)

- `targets/`  : `internship_parser.c` (bản có lỗi), `internship_parser_fixed.c` (bản vá)
- `scripts/`  : fuzzer, script đo coverage, tạo báo cáo (xem Phụ lục A của báo cáo)
- `out/`      : bằng chứng (payload + log ASan/UBSan/LSan), corpus các chiến dịch fuzz, số liệu gcov, hình
- `baocaoATPM (1).docx` : báo cáo

## Seed data (input của vòng chạy đầu tiên)

White-box bắt đầu với **hai seed hợp lệ** (không gây crash):

1. **seed_hop_le** (`make_payload()`):
   - status=0, code_a=0, code_b=0, sent=0, queued=0
   - student_id = `"SV001\0"` (6 byte)
   - extra = rỗng
   - Tổng độ dài ≈ 27 byte

2. **seed_ngan** (`make_payload(student_id=b"SV002\0", extra=b"hello")`):
   - các trường số = 0
   - student_id = `"SV002\0"`
   - extra = `"hello"`
   - Tổng độ dài ≈ 32 byte

Các seed này nằm trong `out/fuzz/whitebox_s*/corpus/id0000.bin` và `id0001.bin`.

## Black-box bounded → White-box

- **Bounded**: sinh payload đúng cấu trúc nhưng các trường bị giới hạn trong miền nghiệp vụ / vùng biên:
  - `status ∈ [0, 2²³)`
  - `code_a, code_b ∈ [0, 10000)`
  - `sent, queued ∈ [0, 2³¹)`
  - `studentId ≤ 31` ký tự printable + NUL
- Khi bounded (hoặc black-box toàn miền) phát hiện lỗi hoặc tăng coverage, payload được lưu vào corpus.
- Các seed/corpus thú vị từ bounded được dùng làm điểm khởi đầu bổ sung cho white-box, giúp kiểm soát và mở rộng số lượng lỗi có thể phát hiện (đặc biệt các nhánh magic value khó tìm bằng random thuần).

## Tái hiện nhanh
    mkdir -p build
    SAN="-g -O0 -fsanitize=address,undefined -fno-omit-frame-pointer"
    gcc $SAN -o build/parser_asan targets/internship_parser.c
    gcc $SAN -o build/fixed_asan  targets/internship_parser_fixed.c
    gcc -c -O0 -o build/cov_shim.o scripts/cov_shim.c
    gcc -g -O0 -no-pie -fsanitize=address,undefined -fsanitize-coverage=trace-pc \
        -o build/parser_cov targets/internship_parser.c build/cov_shim.o
    python3 scripts/evidence_run.py                 # bằng chứng từng lỗi, bản buggy và fixed
    RUNS=3000 scripts/run_campaigns.sh              # 9 chiến dịch fuzz, ~25 phút trên 1 CPU
    python3 scripts/reclassify.py && python3 scripts/measure_gcov.py
    python3 scripts/regression_fixed.py && python3 scripts/make_figures.py
    # tùy chọn (cần z3-solver): python3 scripts/whitebox_fuzz.py
