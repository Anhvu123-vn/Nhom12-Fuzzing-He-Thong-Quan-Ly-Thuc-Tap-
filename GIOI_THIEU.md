# Giới thiệu nhóm & đề tài

## Nhóm 12 – An toàn phần mềm (CSE703093)

| Thông tin | Chi tiết |
|-----------|----------|
| **Trường** | Đại học Phenikaa – Trường Công nghệ Thông tin |
| **Học phần** | An toàn phần mềm (CSE703093) |
| **Giảng viên** | ThS. Vũ Quang Dũng |
| **Thời gian** | Tháng 10 năm 2026 |

### Thành viên

| Họ và tên | Mã SV | Vai trò |
|-----------|-------|---------|
| Đỗ Nguyên Anh Vũ | 23010334 | Code chính, lập kịch bản tự động hóa, phát triển bản vá |
| Nguyễn Phương Ngân | 23010450 | Hỗ trợ code, thu thập bằng chứng, kiểm thử hồi quy, biên tập báo cáo |

---

## Đề tài

**Ứng dụng Fuzzing để kiểm thử API và logic nghiệp vụ trong Hệ thống Quản lý Thực tập Sinh viên**

Nhóm mô phỏng các điểm nóng an toàn của hệ thống quản lý thực tập (NestJS + Prisma) bằng chương trình C (`internship_parser`), sau đó áp dụng **fuzzing black-box** và **white-box (coverage-guided)** để phát hiện lỗi bộ nhớ và logic.

### Các lỗi đã phát hiện & xác nhận

| BUG | Loại lỗi | CWE |
|-----|----------|-----|
| BUG-01 | Buffer overflow (parse student_id) | CWE-120 |
| BUG-02 | Buffer overflow (magic status) | CWE-120 |
| BUG-03 | NULL pointer dereference (unlock pair) | CWE-476 |
| BUG-04 | Memory leak | CWE-401 |
| BUG-05 | Double free | CWE-415 |
| BUG-06 | Use-after-free | CWE-416 |
| BUG-07 | Integer overflow (telemetry) | CWE-190 |

### Kết quả nổi bật

- **White-box** tìm được **5–6 loại lỗi**, độ phủ ~89–92% dòng mã  
- **Black-box** chỉ tìm được **2 loại lỗi**, độ phủ ~71%  
- Bản vá (`internship_parser_fixed.c`) **0 crash** trên 79 payload hồi quy  
- 10/10 test case truy vết yêu cầu **ĐẠT**

### Tài liệu nộp

| File | Mô tả |
|------|--------|
| `BaoCao_Nhom12_Fuzzing.docx` | Báo cáo chính |
| `BienBan_KiemThu_Nhom12.docx` | Biên bản kiểm thử |
| `dactafuzz.xlsx` | Đặc tả yêu cầu, test case, kết quả fuzz |
| `code/` | Mã nguồn, script fuzz, bằng chứng ASan/UBSan |
| `README.md` | Hướng dẫn tái hiện |

---

*Nhóm 12 – CSE703093 – Đại học Phenikaa*
