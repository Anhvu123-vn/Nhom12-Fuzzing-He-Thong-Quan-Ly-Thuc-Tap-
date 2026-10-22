// build_report.js – tạo báo cáo .docx từ số liệu thật trong out/ (fuzz_summary.json, gcov_summary.json, evidence/*)
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Footer, AlignmentType,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber, PageBreak, LevelFormat,
  TableOfContents, VerticalAlign, TabStopType, LineRuleType,
} = require("docx");

const ROOT = path.resolve(__dirname, "..");
const EVI = path.join(ROOT, "out", "evidence");
const FIG = path.join(ROOT, "out", "figures");
const fuzz = JSON.parse(fs.readFileSync(path.join(ROOT, "out", "fuzz_summary.json"), "utf8"));
const gcov = JSON.parse(fs.readFileSync(path.join(ROOT, "out", "gcov_summary.json"), "utf8"));
const wbRes = JSON.parse(fs.readFileSync(path.join(ROOT, "out", "fuzz", "whitebox_s1", "result.json"), "utf8"));
const OUTFILE = process.argv[2] || "/home/claude/w/report.docx";

const FONT = "Times New Roman";
const CW = 9071; // chiều rộng nội dung (DXA): A4 - lề trái 3cm - lề phải 2cm

// ---------- helpers ----------
function runs(text, base = {}) {
  // **đậm**, `code`
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...base }));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(new TextRun({ text: tok.slice(2, -2), bold: true, font: FONT, ...base }));
    else out.push(new TextRun({ text: tok.slice(1, -1), font: "Courier New", size: (base.size || 24) - 2, ...base, ...{ font: "Courier New" } }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...base }));
  return out;
}
const P = (text, o = {}) => new Paragraph({ children: runs(text, o.run || {}), alignment: o.align || AlignmentType.JUSTIFIED, spacing: o.spacing, indent: o.indent, keepNext: o.keepNext });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, font: FONT })], pageBreakBefore: false });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t.replace(/`/g, ""), font: FONT })] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t.replace(/`/g, ""), font: FONT })] });
const BUL = (text, lvl = 0) => new Paragraph({ numbering: { reference: "bul", level: lvl }, children: runs(text), alignment: AlignmentType.JUSTIFIED });
const CAP = (t) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 160, line: 276 }, children: runs(t, { italics: true, size: 22 }) });
const CAPT = (t) => new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 80, line: 276 }, children: runs(t, { italics: true, size: 22 }) });
const PB = () => new Paragraph({ children: [new PageBreak()] });

function code(lines, size = 18) {
  return lines.map((l, i) => new Paragraph({
    spacing: { line: 240, before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 160 : 0 },
    shading: { type: ShadingType.CLEAR, fill: "F3F3F3", color: "auto" },
    indent: { left: 120, right: 120 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: "1A4FA0", space: 4 } },
    keepLines: true,
    children: [new TextRun({ text: l === "" ? " " : l, font: "Courier New", size })],
  }));
}

const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };
function table(widths, header, rows, o = {}) {
  const fs_ = o.size || 19;
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (txt, w, head, align) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders,
    shading: head ? { type: ShadingType.CLEAR, fill: "D9E2F3", color: "auto" } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 }, verticalAlign: VerticalAlign.CENTER,
    children: String(txt).split("\n").map((ln) => new Paragraph({
      alignment: align || AlignmentType.LEFT, spacing: { line: 252, after: 0 },
      children: runs(ln, { size: fs_, bold: head ? true : undefined }),
    })),
  });
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: header.map((h, i) => cell(h, widths[i], true, AlignmentType.CENTER)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], false, o.align && o.align[i])) })),
    ],
  });
}
const spacer = () => new Paragraph({ spacing: { after: 120, line: 240 }, children: [] });
function img(file, w, h) {
  return new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 0, line: 240, lineRule: LineRuleType.AUTO },
    children: [new ImageRun({ type: "png", data: fs.readFileSync(path.join(FIG, file)), transformation: { width: w, height: h },
      altText: { title: file, description: file, name: file } })] });
}
function excerpt(file, keep = 9, maxw = 118) {
  const lines = fs.readFileSync(path.join(EVI, file), "utf8").split("\n");
  const sel = [];
  for (const l of lines) {
    if (/ERROR: (AddressSanitizer|LeakSanitizer)|^(WRITE|READ) of size|^    #[0-3] |^SUMMARY|runtime error|Direct leak|located in stack|^freed by|is located/.test(l)) sel.push(l);
  }
  return sel.slice(0, keep).map((l) => (l.length > maxw ? l.slice(0, maxw - 1) + "…" : l)
    .replace(/\.\.\/fuzzing_internship\/targets\//g, "").replace(/scripts\/\.\.\/targets\//g, ""));
}
const hexdump = (f) => {
  const b = fs.readFileSync(path.join(EVI, f)); const out = [];
  for (let i = 0; i < b.length; i += 24) out.push(b.subarray(i, i + 24).toString("hex").replace(/(..)/g, "$1 ").trim());
  return out;
};
const pct = (x) => x.toFixed(1).replace(".", ",") + "%";
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// ---------- số liệu tổng hợp ----------
const modes = { blackbox: [], bounded: [], whitebox: [] };
for (const k of Object.keys(fuzz)) modes[k.split("_")[0]].push({ key: k, ...fuzz[k], g: gcov[k] });
const linesCov = (g) => Math.round((g.line_pct / 100) * g.lines);
const brCov = (g) => Math.round((g.taken_pct / 100) * g.branches * 2) ; // gcov: nhánh = 2 phía; xem ghi chú
const agg = (m) => ({
  blocks: modes[m].map((x) => x.blocks), states: modes[m].map((x) => x.states), seeds: modes[m].map((x) => x.seeds),
  line: modes[m].map((x) => x.g.line_pct), taken: modes[m].map((x) => x.g.taken_pct),
});
const firstRun = (m, sig) => modes[m].map((x) => (x.findings_fixed[sig] !== undefined ? String(x.findings_fixed[sig]) : "–")).join(" / ");
const SIG = {
  b1: "ASan:stack-buffer-overflow@parse_student_id", b2: "ASan:stack-buffer-overflow@check_status_magic",
  b3: "ASan:SEGV@device_unlock_code", b5: "ASan:heap-use-after-free@close_session",
  b6: "ASan:heap-use-after-free@release_session_buffer", b7: "UBSan:signed integer overflow@line170",
};
const nFound = (m) => modes[m].map((x) => Object.keys(x.findings_fixed).length).join(" / ");

// ====================== NỘI DUNG ======================
const cover = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 0 }, children: [new TextRun({ text: "TRƯỜNG ĐẠI HỌC PHENIKAA", bold: true, size: 30, font: FONT })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: "KHOA HỆ THỐNG THÔNG TIN", bold: true, size: 28, font: FONT })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1500 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "1A4FA0", space: 6 } }, children: [] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: "BÁO CÁO BÀI TẬP LỚN", bold: true, size: 40, font: FONT })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 }, children: [new TextRun({ text: "Học phần CSE703093 – An toàn phần mềm", size: 28, font: FONT })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160, line: 320 }, children: [new TextRun({ text: "FUZZING WHITE-BOX TESTING", bold: true, size: 36, color: "1A4FA0", font: FONT })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160, line: 320 }, children: [new TextRun({ text: "CHO HỆ THỐNG QUẢN LÝ THỰC TẬP SINH VIÊN", bold: true, size: 36, color: "1A4FA0", font: FONT })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1500 }, children: [new TextRun({ text: "(Dự án Fuzzing: so sánh Black-box và White-box)", italics: true, size: 26, font: FONT })] }),
  ...[["Nhóm thực hiện:", "Nhóm 12"], ["Thành viên:", "Nguyễn Phương Ngân\nĐỗ Nguyên Anh Vũ"], ["Giảng viên hướng dẫn:", "ThS. Vũ Quang Dũng"]].map(([a, b]) =>
    new Paragraph({ tabStops: [{ type: TabStopType.LEFT, position: 3300 }], indent: { left: 1200 }, spacing: { after: 100, line: 300 },
      children: [new TextRun({ text: a, bold: true, size: 26, font: FONT }), new TextRun({ text: "\t" + b.split("\n")[0], size: 26, font: FONT }),
        ...(b.includes("\n") ? [new TextRun({ text: "\t" + b.split("\n")[1], size: 26, font: FONT, break: 1 })] : [])] })),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1500 }, children: [new TextRun({ text: "Hà Nội, tháng 10 năm 2026", italics: true, size: 26, font: FONT })] }),
];

const body = [];
const add = (...x) => body.push(...x);

// ---------- 1. GIỚI THIỆU ----------
add(H1("1. Giới thiệu và Mục tiêu"));
add(H2("1.1. Bối cảnh"));
add(P("Hệ thống Quản lý Thực tập Sinh viên (`quan-ly-thuc-tap`) là ứng dụng web xây dựng trên NestJS và Prisma, phục vụ quy trình nộp đơn, phê duyệt và đánh giá thực tập. Dữ liệu đi vào hệ thống qua API gồm mã sinh viên (`studentId`), trạng thái đơn (`ApplicationStatus`), nội dung payload đơn ứng tuyển và các bộ đếm thống kê. Bản thân tầng TypeScript được quản lý bộ nhớ tự động, nhưng trong thực tế các thành phần xử lý dữ liệu nhị phân, parser, thư viện ảnh/tệp hoặc addon native vẫn được viết bằng C/C++. Khi đó những lỗi bộ nhớ kinh điển (CWE-120, CWE-415, CWE-416, CWE-476...) hoàn toàn có thể xuất hiện."));
add(P("Điểm khó của các lỗi này là chúng chỉ lộ ra khi đầu vào thỏa một điều kiện rất hẹp, ví dụ một mã trạng thái đặc biệt hoặc một cặp mã mở khóa. Kiểm thử ngẫu nhiên (black-box) gần như không thể đoán trúng các điều kiện đó trong thời gian hữu hạn, đây chính là động lực của white-box fuzzing: dùng thông tin từ mã nguồn và phản hồi độ phủ (coverage) để dẫn đường cho việc sinh đầu vào. Báo cáo này hiện thực hóa ý tưởng đó trên một chương trình C mô phỏng các điểm nóng của hệ thống, theo định hướng của giảng viên: mô phỏng truyền dữ liệu, cấp phát bộ nhớ và các trạng thái có điều kiện, đo độ phủ, rồi fuzzing và đối chiếu kết quả với CWE/CVE."));
add(H2("1.2. Mục tiêu cụ thể"));
add(BUL("**M1.** Viết chương trình C (`internship_parser.c`) mô phỏng ít nhất 7 điểm nóng an toàn: sao chép dữ liệu vào bộ đệm cố định, cấp phát/giải phóng session và log, nhánh trạng thái đặc biệt, cặp mã mở khóa, bộ đếm telemetry."));
add(BUL("**M2.** Đo độ phủ mã nguồn bằng `gcov` (dòng và nhánh) và độ phủ khối cơ bản theo thời gian thực thi (trace-pc)."));
add(BUL("**M3.** Xây dựng fuzzer white-box dùng coverage làm phản hồi: có seed ban đầu, đếm số vòng chạy, ghi nhận trạng thái sinh ra, cập nhật seed khi có phủ mới, phát hiện crash/hang."));
add(BUL("**M4.** So sánh định lượng với black-box (toàn miền int32 và vùng bounded) trên cùng harness, cùng ngân sách 3.000 lần thực thi, lặp 3 seed ngẫu nhiên."));
add(BUL("**M5.** Phát hiện và xác nhận tối thiểu 5 loại lỗi bằng ASan/UBSan/LSan, mỗi lỗi kèm payload cụ thể và log."));
add(BUL("**M6.** Vá lỗi và xác nhận bản vá không còn lỗi trên toàn bộ payload đã thu thập; ánh xạ từng lỗi sang CWE và CVE thực tế tương tự."));
add(H2("1.3. Phạm vi"));
add(P("**Trong phạm vi:** chương trình C mô phỏng (308 dòng), build sanitizer và build đo coverage, ba chiến lược fuzzing, bản vá và kiểm tra hồi quy, đối chiếu CWE/CVE."));
add(P("**Ngoài phạm vi:** phân tích mã TypeScript/NestJS thật, mô hình hóa Kripke và kiểm chứng BMC (Chương 1 và 3 không thực hiện trong báo cáo này), fuzzing coverage-guided quy mô lớn bằng AFL++/libFuzzer, và việc gán mã CVE mới cho chương trình mô phỏng."));

// ---------- 2. MÔ TẢ HỆ THỐNG ----------
add(H1("2. Mô tả chương trình mục tiêu"));
add(H2("2.1. Từ API của hệ thống thật sang cấu trúc dữ liệu C"));
add(P("Để fuzz trên tệp nhị phân, nhóm xác định trước những trường dữ liệu mà API thật truyền vào, kiểu và kích cỡ của từng trường, rồi biểu diễn chúng thành một payload nhị phân có định dạng cố định. Nhờ vậy fuzzer điều khiển được từng trường một cách độc lập, điều kiện cần để so sánh công bằng black-box và white-box."));
add(CAPT("Bảng 1. Ánh xạ trường API → payload nhị phân → hàm C → rủi ro"));
add(table([1700, 1250, 900, 2300, 2921],
  ["Trường API / nghiệp vụ", "Kiểu & kích cỡ", "Offset (byte)", "Hàm C xử lý", "Rủi ro khi thiếu kiểm tra"],
  [
    ["`ApplicationStatus` (trạng thái đơn)", "uint32, 4 B", "0–3", "`check_status_magic()`", "Mã đặc biệt `0x494E54` ('INT') đi vào nhánh copy dữ liệu → CWE-120; cũng quyết định đường đóng session"],
    ["Mã mở khóa `code_a`, `code_b`", "int32 ×2, 8 B", "4–11", "`device_unlock_code()`", "Cặp (7421, 3390) → ghi qua con trỏ NULL, CWE-476"],
    ["Bộ đếm `sent`, `queued` (telemetry)", "int32 ×2, 8 B", "12–19", "`telemetry_byte_counter()`", "Cộng hai int32 không kiểm tra tràn, CWE-190"],
    ["`studentId`", "1 B độ dài + N B nội dung (đích 16 B)", "20, 21…", "`parse_student_id()`", "`strcpy` không giới hạn, CWE-120"],
    ["Payload đơn / nhật ký", "Phần còn lại, tới 512 B", "21+N…", "`write_log_entry()`, `allocate_session()`, `close_session()`, `release_session_buffer()`", "Rò rỉ (CWE-401), double-free (CWE-415), use-after-free (CWE-416)"],
  ], { size: 18 }));
add(spacer());
add(H2("2.2. Chương trình C mô phỏng"));
add(P("Chương trình `internship_parser.c` dài 308 dòng, gồm 10 hàm (9 hàm xử lý và `main`), trong đó 110 dòng là dòng thực thi (số liệu từ `gcov`). Đầu vào là một tệp nhị phân truyền qua `argv[1]` hoặc `stdin`, đọc tối đa 512 byte vào mảng trên stack. Hàm trung tâm `process_application_payload()` tách payload thành các trường, lần lượt gọi các hàm xử lý theo thứ tự: phân tích `studentId`, kiểm tra trạng thái, kiểm tra mã mở khóa, cập nhật bộ đếm, rồi cấp phát session/log và giải phóng chúng. Bản vá `internship_parser_fixed.c` (225 dòng) giữ nguyên giao diện và chỉ sửa các lỗi."));
add(H2("2.3. Luồng dữ liệu và bề mặt tấn công"));
add(img("fig1_architecture.png", 560, 288));
add(CAP("Hình 1. Luồng dữ liệu và bề mặt tấn công của chương trình mô phỏng"));
add(P("**Bề mặt tấn công** của chương trình là toàn bộ byte của tệp payload, bởi cả nội dung lẫn độ dài tệp đều do bên ngoài kiểm soát. Không có đầu vào nào khác (không có socket, biến môi trường hay cấu hình), nên mọi lỗi tìm được đều có thể tái hiện chỉ bằng một tệp nhị phân. Điều này thuận lợi cho fuzzing vì mỗi lần thực thi là một tiến trình độc lập, kết quả (mã thoát, thông báo sanitizer) hoàn toàn xác định."));
add(H2("2.4. Các kịch bản mô phỏng"));
add(CAPT("Bảng 2. Kịch bản theo nhóm: truyền dữ liệu, cấp phát bộ nhớ, trạng thái có điều kiện"));
add(table([1700, 2300, 3071, 2000],
  ["Nhóm kịch bản", "Hàm", "Điều kiện kích hoạt", "BUG / CWE"],
  [
    ["Truyền dữ liệu", "`parse_student_id()`", "`studentId` dài hơn 15 ký tự (hoặc không có byte NUL kết thúc)", "BUG-01 / CWE-120"],
    ["Truyền dữ liệu", "`check_status_magic()`", "`status == 0x494E54` và dữ liệu thừa dài hơn 16 byte", "BUG-02 / CWE-120"],
    ["Cấp phát bộ nhớ", "`write_log_entry()`", "`malloc` của nội dung thất bại sau khi đã cấp phát bản ghi", "BUG-04 / CWE-401"],
    ["Cấp phát bộ nhớ", "`close_session()`", "`status == 0x494E54` làm `close_session` bị gọi hai lần", "BUG-05 / CWE-415"],
    ["Cấp phát bộ nhớ", "`release_session_buffer()`", "`status == 0xDEAD`: ghi vào bộ đệm sau khi `free`", "BUG-06 / CWE-416"],
    ["Trạng thái có điều kiện", "`device_unlock_code()`", "`code_a == 7421 && code_b == 3390`", "BUG-03 / CWE-476"],
    ["Trạng thái có điều kiện", "`telemetry_byte_counter()`", "`sent + queued` vượt `INT32_MAX`", "BUG-07 / CWE-190"],
  ], { size: 18 }));
add(spacer());

// ---------- 3. PHƯƠNG PHÁP ----------
add(H1("3. Phương pháp thực hiện"));
add(H2("3.1. Môi trường và các bản build"));
add(P("Thực nghiệm chạy trên Linux (Ubuntu 24), GCC 13.3.0, Python 3.12. Cùng một mã nguồn được biên dịch thành ba bản để phục vụ ba mục đích khác nhau:"));
add(CAPT("Bảng 3. Các bản build và mục đích"));
add(table([1900, 4271, 2900],
  ["Bản build", "Lệnh biên dịch", "Mục đích"],
  [
    ["`parser_asan`", "`gcc -g -O0 -fsanitize=address,undefined -fno-omit-frame-pointer`", "Xác nhận lỗi bộ nhớ và hành vi không xác định, lấy file:line"],
    ["`parser_cov`", "`gcc -g -O0 -no-pie -fsanitize=address,undefined -fsanitize-coverage=trace-pc` + `cov_shim.c`", "Phản hồi coverage cho fuzzer (bitmap 64 KiB ghi qua mmap, vẫn còn khi ASan abort)"],
    ["`parser_gcov`", "`gcc -g -O0 --coverage` + `gcov_shim.c`", "Đo độ phủ dòng/nhánh bằng `gcov`; shim gọi `__gcov_dump()` khi tiến trình bị SIGSEGV/SIGABRT"],
  ], { size: 18 }));
add(spacer());
add(H2("3.2. Xác nhận lỗi bằng sanitizer (Chương 2)"));
add(P("AddressSanitizer (ASan) phát hiện tràn bộ đệm stack/heap, use-after-free và double-free; UndefinedBehaviorSanitizer (UBSan) phát hiện tràn số nguyên có dấu và ghi qua con trỏ NULL; LeakSanitizer (LSan, đi kèm ASan) phát hiện rò rỉ khi thoát. Với mỗi lỗi, nhóm tạo một payload tối thiểu bằng `evidence_run.py`, chạy trên bản buggy và bản fixed, lưu toàn bộ log vào `out/evidence/`. Lưu ý quan trọng khi thiết kế payload: ASan dừng ở lỗi đầu tiên, nên payload cho BUG-02, BUG-05, BUG-06 buộc phải có `studentId` ngắn và kết thúc bằng byte NUL, nếu không `strcpy` ở `parse_student_id()` sẽ tràn trước và che mất lỗi cần kiểm tra."));
add(P("BUG-04 (rò rỉ) chỉ xảy ra khi `malloc` thất bại, điều mà payload không điều khiển được. Nhóm xác nhận nó bằng một harness riêng (`leak_harness.c`) gọi `write_log_entry()` với độ dài `1<<62` để buộc `malloc` trả về NULL, kèm `ASAN_OPTIONS=allocator_may_return_null=1`.", { align: AlignmentType.LEFT }));
add(H2("3.3. Fuzzing black-box và white-box (Chương 4)"));
add(P("Cả ba chiến lược dùng chung harness `parser_cov`, cùng ngân sách 3.000 lần thực thi và chạy với 3 seed ngẫu nhiên (1, 2, 3), tức 9 chiến dịch, 27.000 lần chạy. Mỗi lần chạy kết thúc trong tối đa 1 giây, quá hạn được tính là hang."));
add(CAPT("Bảng 4. Ba chiến lược fuzzing"));
add(table([1700, 3000, 2271, 2100],
  ["Chiến lược", "Cách sinh đầu vào", "Dùng phản hồi coverage?", "Vai trò"],
  [
    ["Black-box (toàn miền)", "Chuỗi byte ngẫu nhiên dài 21–119 byte; mọi trường nhận giá trị ngẫu nhiên trên toàn miền int32/uint32", "Không (chỉ ghi lại để đo)", "Đường cơ sở"],
    ["Black-box (bounded)", "Payload đúng cấu trúc, trường nằm trong vùng bounded: status ∈ [0, 2²³), `code_a`, `code_b` ∈ [0, 10000), `sent`, `queued` ∈ [0, 2³¹), `studentId` ≤ 31 ký tự in được kèm NUL", "Không", "Kiểm tra vùng bounded theo góp ý của giảng viên"],
    ["White-box (coverage-guided)", "Seed ban đầu + mutation theo trường, dùng từ điển hằng số trích từ điều kiện rẽ nhánh trong mã nguồn", "Có: giữ lại seed khi có khối cơ bản mới", "Đối tượng chính"],
  ], { size: 18 }));
add(spacer());
add(P(`Fuzzer white-box (\`cov_fuzz.py\`, chế độ \`whitebox\`) gồm bốn thành phần. **(1) Từ điển hằng số:** quét mã nguồn, gom các giá trị xuất hiện trong điều kiện \`==, <, >, <=, >=\` và các \`#define\` được tham chiếu (MAGIC_STATUS, MAGIC_UNLOCK_A/B, TELEMETRY_LIMIT...), thêm các giá trị lân cận (±1) và giá trị biên int32, thu được ${wbRes.dict_size} giá trị. **(2) Seed ban đầu:** hai payload hợp lệ (mã sinh viên ngắn, có và không có dữ liệu thừa). **(3) Mutation theo trường:** chọn một đến ba trường để thay bằng giá trị từ từ điển, lật bit, giá trị ngẫu nhiên, hoặc kéo dài/rút ngắn \`studentId\` và phần dữ liệu thừa. **(4) Cập nhật seed:** nếu lần chạy đạt khối cơ bản chưa từng thấy thì đầu vào đó được thêm vào hàng đợi và dùng làm seed cho các vòng sau.`));
add(...code([
  "queue = [seed_hop_le, seed_ngan]",
  "for i in range(1, RUNS + 1):",
  "    p = chon_seed_va_mutation(queue)       # mutation theo trường",
  "    rc, err, hang, cov = execute(p)         # ASan+UBSan+trace-pc",
  "    if cov - global_cov:                    # có khối cơ bản mới",
  "        global_cov |= cov",
  "        queue.append(p)                     # cập nhật seed",
  "    sig = signature(err)                    # loại lỗi + hàm",
  "    if sig and sig not in findings:",
  "        findings[sig] = {\"first_run\": i, \"payload\": p}",
  "    hangs += hang",
]));
add(CAP("Đoạn mã 1. Vòng lặp chính của fuzzer white-box (rút gọn từ `cov_fuzz.py`)"));
add(P("Để so sánh công bằng, black-box cũng được thực thi trên `parser_cov` và coverage vẫn được ghi, nhưng không bao giờ dùng để chọn đầu vào. Các lỗi được gộp theo chữ ký (loại lỗi và hàm xảy ra), vì cùng một lỗi có thể bị kích hoạt hàng trăm lần."));
add(H2("3.4. Giải ràng buộc bằng SMT (Z3)"));
add(P("Điều kiện rẽ nhánh của hai nhánh \"magic\" đều là phép so sánh bằng trên số nguyên 32 bit, nên có thể biểu diễn thành ràng buộc và giao cho bộ giải. Script `whitebox_fuzz.py` làm đúng việc đó:"));
add(...code([
  "a = BitVec(\"code_a\", 32); b = BitVec(\"code_b\", 32)",
  "s = Solver()",
  "s.add(a == MAGIC_A)            # code_a == 7421",
  "s.add(b == MAGIC_B)            # code_b == 3390",
  "if s.check() == sat:",
  "    m = s.model()              # → (7421, 3390), 1 lần gọi solver",
]));
add(CAP("Đoạn mã 2. Ràng buộc Z3 cho cặp mở khóa (`whitebox_fuzz.py`)"));
add(P("**Lưu ý trung thực:** số liệu ở Chương 4 của báo cáo này được tạo bằng fuzzer coverage-guided ở mục 3.3, không dùng Z3, vì môi trường chạy thực nghiệm không cài `z3-solver`. Script Z3 vẫn được nộp kèm và chạy được trên máy có `pip install z3-solver` (xem Phụ lục A); với điều kiện bằng đơn giản như trên, kết quả của nó tương đương việc lấy hằng số từ từ điển."));
add(H2("3.5. Các độ đo"));
add(BUL("**Khối cơ bản đã phủ (trace-pc):** số khối khác nhau mà fuzzer đạt tới theo thời gian; dùng để vẽ đường cong coverage."));
add(BUL("**Độ phủ dòng và nhánh (`gcov`):** chạy lại toàn bộ corpus (các đầu vào làm tăng coverage) trên `parser_gcov`; nhánh được tính theo tỷ lệ nhánh được đi ít nhất một lần (*taken at least once*)."));
add(BUL("**Trạng thái sinh ra:** số tập khối cơ bản khác nhau (đường đi khác nhau) mà một chiến dịch đạt được."));
add(BUL("**Lỗi tìm thấy:** số chữ ký lỗi khác nhau và lần chạy đầu tiên tìm ra từng lỗi (*first_run*); **hang:** số lần quá 1 giây."));

// ---------- 4. KẾT QUẢ ----------
add(H1("4. Kết quả và Phân tích"));
add(H2("4.1. Tổng hợp lỗi phát hiện"));
add(CAPT("Bảng 5. Lỗi đã xác nhận bằng sanitizer (payload và log trong out/evidence/)"));
add(table([800, 2350, 900, 2100, 1650, 1271],
  ["ID", "Lỗi và vị trí", "CWE", "Điều kiện / payload", "Xác nhận bởi", "Bản fixed"],
  [
    ["BUG-01", "Stack buffer overflow, `strcpy` trong `parse_student_id()`, dòng 72", "CWE-120", "`studentId` = 64 byte 'A'", "ASan: `WRITE of size 65`", "rc=0, không lỗi"],
    ["BUG-02", "Stack buffer overflow, `memcpy` trong `check_status_magic()`, dòng 141", "CWE-120", "`status=0x494E54`, ID ngắn, 40 byte 'B' dữ liệu thừa", "ASan: `WRITE of size 40`", "rc=0, không lỗi"],
    ["BUG-03", "Ghi qua con trỏ NULL trong `device_unlock_code()`, dòng 158", "CWE-476", "`code_a=7421`, `code_b=3390`", "UBSan + ASan SEGV", "rc=0, không lỗi"],
    ["BUG-04", "Rò rỉ bản ghi log khi `malloc` thất bại, `write_log_entry()`, dòng 86", "CWE-401", "Không điều khiển được bằng payload; harness ép `malloc` NULL", "LSan: 24 byte rò rỉ", "Không rò rỉ"],
    ["BUG-05", "`close_session()` bị gọi hai lần, dòng 109", "CWE-415", "`status=0x494E54`, ID ngắn, không có dữ liệu thừa", "ASan: `heap-use-after-free` (READ 8 byte)", "rc=0, không lỗi"],
    ["BUG-06", "Ghi sau `free` trong `release_session_buffer()`, dòng 126", "CWE-416", "`status=0xDEAD`, ID ngắn", "ASan: `heap-use-after-free` (WRITE 1 byte)", "rc=0, không lỗi"],
    ["BUG-07", "Tràn int32 khi cộng `sent+queued`, `telemetry_byte_counter()`, dòng 170", "CWE-190", "`sent=1.500.000.000`, `queued=1.000.000.000`", "UBSan: `signed integer overflow`", "Từ chối an toàn, không lỗi"],
  ], { size: 17 }));
add(spacer());
add(P("Cả 7 lỗi đều được xác nhận trên bản buggy và biến mất trên bản fixed với đúng payload đó. Hai nhận xét kỹ thuật cần lưu ý: (1) BUG-05 là double-free về mặt thiết kế (hàm được gọi hai lần trên cùng con trỏ), nhưng ASan báo **heap-use-after-free** trước, vì lần gọi thứ hai đọc `sess->buf` trên bộ nhớ đã giải phóng, nên chữ ký trong log là UAF chứ không phải `attempting double-free`; (2) UBSan không làm chương trình dừng, vì vậy BUG-07 có mã thoát 0 dù lỗi vẫn được ghi nhận trong stderr."));
add(H2("4.2. Counterexample cụ thể cho từng lỗi"));
add(P("Phần này trình bày đầu vào gây lỗi và trích đoạn log sanitizer gốc. Địa chỉ và PID thay đổi theo từng lần chạy; loại lỗi, hàm và số dòng thì ổn định."));
const bugs = [
  ["BUG-01 – Stack buffer overflow (CWE-120)", "BUG-01_overflow_student_id", "Đầu vào: `status=0`, `id_len=64`, `studentId` = 64 byte 'A' (tổng 85 byte). `strcpy` chép 65 byte (kể cả NUL) vào mảng 16 byte."],
  ["BUG-02 – Stack buffer overflow trong nhánh magic (CWE-120)", "BUG-02_overflow_magic_status", "Đầu vào: `status=0x00494E54`, `studentId=\"SV001\\0\"` (6 byte), 40 byte 'B' làm dữ liệu thừa. `memcpy` chép 40 byte vào `local[16]`."],
  ["BUG-03 – Null pointer dereference (CWE-476)", "BUG-03_null_deref_unlock", "Đầu vào: `code_a=7421`, `code_b=3390`, các trường còn lại bằng 0."],
  ["BUG-05 – Gọi `close_session` hai lần (CWE-415)", "BUG-05_double_free_close_session", "Đầu vào: `status=0x00494E54`, `studentId=\"SV001\\0\"`, không có dữ liệu thừa (để không dính BUG-02)."],
  ["BUG-06 – Use-after-free (CWE-416)", "BUG-06_uaf_release_buffer", "Đầu vào: `status=0x0000DEAD`, `studentId=\"SV001\\0\"`."],
  ["BUG-07 – Signed integer overflow (CWE-190)", "BUG-07_int_overflow_telemetry", "Đầu vào: `sent=1.500.000.000`, `queued=1.000.000.000` (tổng 2,5 tỷ > INT32_MAX)."],
];
for (const [title, base, desc] of bugs) {
  add(H3(title));
  add(P(desc, { keepNext: true }));
  add(...code(excerpt(base + ".buggy.log", base.includes("07") ? 4 : 7)));
}
add(H3("BUG-04 – Memory leak (CWE-401)"));
add(P("Đầu vào: gọi `write_log_entry(\"AUTH_FAIL_LOG\", 1<<62)` để `malloc(msg_len+1)` thất bại. Bản buggy trả về NULL mà không giải phóng bản ghi `LogEntry` đã cấp phát; bản fixed gọi `free(entry)` trước khi thoát, nên LSan không báo rò rỉ.", { keepNext: true }));
add(...code(excerpt("BUG-04_leak_write_log_entry.buggy.log", 4)));
add(H2("4.3. Độ phủ và hành vi của từng chiến lược"));
const A = { blackbox: agg("blackbox"), bounded: agg("bounded"), whitebox: agg("whitebox") };
const b0 = gcov.baseline_benign_seed;
const rowCov = (name, a) => [name, a.blocks.join(" / "), a.states.join(" / "), a.line.map(pct).join(" / "), a.taken.map(pct).join(" / ")];
add(CAPT("Bảng 6. Độ phủ sau 3.000 lần thực thi (3 seed: s1 / s2 / s3)"));
add(table([2000, 1500, 1500, 2071, 2000],
  ["Chiến lược", "Khối cơ bản đã phủ", "Trạng thái sinh ra", "Độ phủ dòng (gcov)", "Nhánh được đi (gcov)"],
  [
    ["Chỉ chạy seed hợp lệ (mốc so sánh)", "–", "1", pct(b0.line_pct), pct(b0.taken_pct)],
    rowCov("Black-box (toàn miền)", A.blackbox),
    rowCov("Black-box (bounded)", A.bounded),
    rowCov("White-box (coverage-guided)", A.whitebox),
  ], { size: 17, align: [null, AlignmentType.CENTER, AlignmentType.CENTER, AlignmentType.CENTER, AlignmentType.CENTER] }));
add(spacer());
add(img("fig2_coverage_curve.png", 470, 251));
add(CAP("Hình 2. Số khối cơ bản đã phủ theo số lần thực thi (mỗi đường là một seed)"));
add(P(`Hai biến thể black-box dừng ở **56 khối** và **70,9% số dòng** ngay trong vài trăm lần chạy đầu, rồi không tăng thêm trong suốt phần còn lại của ngân sách. Nguyên nhân: chúng chỉ chạm hai điều kiện dễ (ID dài, tổng telemetry tràn); mọi lần chạy chạm ID dài đều bị ASan dừng ở \`parse_student_id()\`, nên đoạn mã phía sau không bao giờ được thực thi. Việc thu hẹp vào vùng bounded không giúp gì, vì các hằng số cần đoán vẫn có xác suất cực nhỏ (chẳng hạn trúng cặp (7421, 3390) trong vùng [0, 10000)² là 1/10⁸ mỗi lần).`));
add(P(`Fuzzer white-box đạt **73–74 khối** (khoảng +30% so với black-box), **89,1–91,8% số dòng** và **64,8–68,5% số nhánh được đi** (black-box: 42,6–44,4%). Sau khi nhận ra sự khác biệt này, ta cũng cần đọc đúng nguyên nhân: coverage tăng không phải vì chạy nhiều hơn mà vì cơ chế *cập nhật seed* giữ lại các đầu vào có ID ngắn, có NUL, rồi mutation tiếp tục từ chúng để đi sâu qua \`parse_student_id()\` tới các nhánh phía sau. Đường cong ở Hình 2 cho thấy phần lớn coverage đạt được trong khoảng 500 lần chạy đầu, sau đó chỉ còn tăng thêm 1–2 khối.`));
add(P(`Các dòng còn lại chưa phủ (9 trong 110 dòng, theo \`gcov\` trên corpus white-box seed 1) đều là đường xử lý lỗi môi trường: \`malloc\` thất bại ở \`write_log_entry()\` (dòng 92) và \`allocate_session()\` (dòng 187–188), \`fopen\` thất bại, đọc từ \`stdin\`, đầu vào rỗng (dòng 293–304), cùng dòng 259 chỉ chạy được nếu BUG-05 không dừng chương trình. Những đường này không thể kích hoạt bằng nội dung payload, đây là giới hạn của kỹ thuật fuzzing đầu vào chứ không phải của fuzzer.`));
add(P(`**Hang:** không có hang nào trong 27.000 lần chạy. Điều này nhất quán với mã nguồn: chương trình không có vòng lặp nào có số lần phụ thuộc vào đầu vào, nên không tồn tại điều kiện treo để fuzzer tìm ra.`));
add(H2("4.4. So sánh định lượng black-box và white-box"));
add(CAPT("Bảng 7. Lần chạy đầu tiên phát hiện từng lỗi (s1 / s2 / s3; “–” = không tìm thấy trong 3.000 lần)"));
add(table([2150, 1100, 1940, 1940, 1941],
  ["Lỗi (hàm)", "CWE", "Black-box toàn miền", "Black-box bounded", "White-box"],
  [
    ["BUG-01 `parse_student_id`", "120", firstRun("blackbox", SIG.b1), firstRun("bounded", SIG.b1), firstRun("whitebox", SIG.b1)],
    ["BUG-07 `telemetry_byte_counter` (UBSan)", "190", firstRun("blackbox", SIG.b7), firstRun("bounded", SIG.b7), firstRun("whitebox", SIG.b7)],
    ["BUG-06 `release_session_buffer`", "416", firstRun("blackbox", SIG.b6), firstRun("bounded", SIG.b6), firstRun("whitebox", SIG.b6)],
    ["BUG-02 `check_status_magic`", "120", firstRun("blackbox", SIG.b2), firstRun("bounded", SIG.b2), firstRun("whitebox", SIG.b2)],
    ["BUG-05 `close_session`", "415", firstRun("blackbox", SIG.b5), firstRun("bounded", SIG.b5), firstRun("whitebox", SIG.b5)],
    ["BUG-03 `device_unlock_code`", "476", firstRun("blackbox", SIG.b3), firstRun("bounded", SIG.b3), firstRun("whitebox", SIG.b3)],
    ["BUG-04 `write_log_entry`", "401", "–", "–", "– (cần `malloc` thất bại)"],
    ["**Số loại lỗi tìm thấy**", "", nFound("blackbox"), nFound("bounded"), nFound("whitebox")],
  ], { size: 17, align: [null, AlignmentType.CENTER, AlignmentType.CENTER, AlignmentType.CENTER, AlignmentType.CENTER] }));
add(spacer());
add(P("**Phân tích.** Kết quả có ba điểm đáng chú ý, trong đó có một điểm đi ngược dự đoán ban đầu của nhóm:"));
add(BUL("**Lỗi nằm trong vùng “dày” thì black-box tìm rất nhanh, thậm chí nhanh hơn white-box.** BUG-01 và BUG-07 bị phát hiện ngay trong vài lần chạy đầu (lần thứ 1–27), còn white-box cần 18–54 lần cho BUG-01 và đến 225 lần cho BUG-07 ở seed 2. Lý do: mọi chuỗi dài hơn 15 ký tự đều kích hoạt BUG-01, và hai số int32 ngẫu nhiên cộng lại tràn với xác suất cao (cỡ 25% với miền toàn bộ, khoảng 50% với miền [0, 2³¹)), còn white-box xuất phát từ seed hợp lệ rồi mới mutation dần."));
add(BUL("**Lỗi đứng sau điều kiện hẹp thì chỉ white-box tìm được.** BUG-02, BUG-05, BUG-06 cần `status` bằng đúng `0x494E54` hoặc `0xDEAD` (xác suất 2⁻³² mỗi lần với black-box); white-box tìm thấy cả ba ở cả ba seed, trong 46–265 lần chạy. Black-box tìm 0/3 lỗi loại này trong cả 18.000 lần chạy của hai biến thể."));
add(BUL("**White-box chưa chắc luôn thắng với điều kiện hai tham số.** BUG-03 cần đồng thời `code_a=7421` và `code_b=3390`. Chỉ seed 1 tìm ra (lần 1.975), seed 2 và 3 không tìm ra trong 3.000 lần. Hành vi này hợp lý: mutation chỉ đặt từng trường một từ từ điển, nên phải gặp đúng lúc trường kia đã có giá trị đúng; coverage chỉ giúp khi nhánh trung gian (`code_a == 7421` đúng) tạo ra khối mới, và khi đó seed đó được giữ lại, nhưng cần thêm một bước mutation `code_b` may mắn. Cách giải ràng buộc đồng thời bằng Z3 (mục 3.4) sẽ tìm được cặp này trong một lần gọi."));
add(P(`Tổng hợp: black-box tìm được 2/6 loại lỗi có thể kích hoạt bằng đầu vào (cả hai biến thể, cả ba seed), white-box tìm được 5/6 ở seed 2 và 3, và 6/6 ở seed 1. Tốc độ thực thi cũng khác: mỗi chiến dịch black-box mất 125–170 giây, white-box 49–63 giây cho cùng 3.000 lần, chủ yếu vì black-box làm ASan phải in báo cáo lỗi (kèm giải mã symbol) ở phần lớn lần chạy, trong khi white-box giữ được nhiều lần chạy hợp lệ không lỗi. Đây là hiệu ứng phụ của cách làm, không phải kết luận về thuật toán.`));
add(H2("4.5. Xác nhận bản vá"));
add(P("Nhóm gộp mọi payload thu được (các đầu vào gây lỗi, các đầu vào làm tăng coverage của cả 9 chiến dịch và 6 payload BUG-xx) và chạy trên cả hai bản đều dưới ASan+UBSan:"));
add(CAPT("Bảng 8. Kiểm tra hồi quy bản fixed (`regression_fixed.py`)"));
add(table([3500, 1800, 1850, 1921],
  ["Bộ payload", "Số payload", "Bản buggy: lỗi/crash", "Bản fixed: lỗi/crash"],
  [["Tất cả payload của 9 chiến dịch + payload BUG-xx", "79", "55", "0"]],
  { size: 18, align: [null, AlignmentType.CENTER, AlignmentType.CENTER, AlignmentType.CENTER] }));
add(spacer());
add(CAPT("Bảng 9. Các thay đổi trong bản vá"));
add(table([2300, 3500, 3271],
  ["Hàm", "Mã lỗi (buggy)", "Mã đã vá (fixed)"],
  [
    ["`parse_student_id`", "`strcpy(out_id, raw_id)`", "`memcpy` với `n = min(raw_len, 15)` rồi gán NUL cuối"],
    ["`write_log_entry`", "Thoát mà không `free(entry)`", "`free(entry)` trước `return NULL`"],
    ["`close_session`", "Gọi hai lần trên cùng con trỏ", "Chỉ `free` một lần; đường gọi hai lần bị loại bỏ"],
    ["`release_session_buffer`", "`free(buf)` rồi ghi `buf[0]`", "Không ghi sau `free`, đặt `buf = NULL`"],
    ["`check_status_magic`", "`memcpy(local, payload, plen)`", "Giới hạn `n ≤ sizeof(local) - 1`"],
    ["`device_unlock_code`", "`*p = 42` với `p = NULL`", "Chỉ trả về mã thành công, không ghi con trỏ NULL"],
    ["`telemetry_byte_counter`", "`sent + queued` không kiểm tra", "`if (sent > LIMIT - queued) return -1` trước khi cộng"],
  ], { size: 18 }));
add(spacer());
add(H2("4.6. Phân loại CWE/CVE và mức độ rủi ro"));
add(P("Bảng sau đối chiếu từng lỗi với CWE tương ứng và một CVE thực tế cùng loại. Các CVE chỉ nhằm minh họa hậu quả của cùng một lớp lỗi trong phần mềm thật; chương trình mô phỏng của nhóm không phải là sản phẩm phát hành nên **không được gán mã CVE**. Mức rủi ro là đánh giá định tính của nhóm, dựa trên hậu quả điển hình của lớp lỗi."));
add(CAPT("Bảng 10. Đối chiếu CWE/CVE"));
add(table([1000, 1500, 1050, 3300, 2221],
  ["BUG", "CWE", "Rủi ro", "CVE cùng lớp lỗi (nguồn tra cứu: MITRE CWE, NVD và các CSDL CVE tổng hợp)", "Nhận xét"],
  [
    ["01, 02", "CWE-120 Buffer Copy without Checking Size of Input", "Cao", "CVE-2023-42801: tràn stack do `strcpy` vào bộ đệm cố định trong `extractVersionQuadFromString` (moonlight-common-c)", "Cùng mẫu `strcpy` vào mảng kích thước cố định như BUG-01"],
    ["05", "CWE-415 Double Free", "Cao", "CVE-2023-45664: double-free trong `stbi__load_gif_main_outofmem` (stb_image)", "Đường lỗi xảy ra do xử lý tệp sai định dạng, giống nhánh trạng thái đặc biệt của BUG-05"],
    ["06", "CWE-416 Use After Free", "Cao", "CVE-2024-4741: use-after-free với `SSL_free_buffers` (OpenSSL)", "Ghi vào bộ đệm đã giải phóng có thể bị khai thác để ghi đè dữ liệu"],
    ["03", "CWE-476 NULL Pointer Dereference", "Trung bình (từ chối dịch vụ)", "CVE-2021-34798: NULL pointer dereference trong lõi httpd của Apache HTTP Server", "Đa số chỉ gây crash, nhưng với dịch vụ web là đủ để làm sập tiến trình"],
    ["07", "CWE-190 Integer Overflow or Wraparound", "Trung bình đến cao", "CVE-2021-30860: lỗi xác thực đầu vào dẫn tới tràn số nguyên (ví dụ trong MITRE, bị khai thác thực tế theo CISA KEV)", "Tự nó chỉ làm sai bộ đếm; nguy hiểm khi kết quả dùng làm kích thước cấp phát"],
    ["04", "CWE-401 Missing Release of Memory", "Thấp đến trung bình", "CVE-2023-53017: rò rỉ bộ nhớ ở đường lỗi `hci_update_adv_data()` khi `hci_cmd_sync_queue()` thất bại (nhân Linux, Bluetooth)", "Cùng mẫu rò rỉ ở đường xử lý lỗi như `write_log_entry()`"],
  ], { size: 16 }));
add(spacer());

// ---------- 5. THẢO LUẬN ----------
add(H1("5. Thảo luận và Hạn chế"));
add(H2("5.1. Đối chiếu với lý thuyết đã học"));
add(P("Kết quả phù hợp với lý thuyết Chương 4 ở hai điểm chính: black-box hiệu quả với không gian lỗi dày và bất lực trước điều kiện bằng hiếm (hằng số magic 32 bit có xác suất 2⁻³² ≈ 2,3×10⁻¹⁰ mỗi lần); còn fuzzing dựa trên phản hồi coverage giữ được các đầu vào “đi xa hơn” và nhờ đó mở rộng độ phủ từ 56 lên 73–74 khối. Điểm không khớp với kỳ vọng ban đầu là white-box không hơn black-box ở mọi lỗi: với lỗi dày (BUG-01, BUG-07) black-box thắng về tốc độ phát hiện, và với điều kiện hai tham số (BUG-03) white-box dựa trên mutation chưa chắc tìm ra. Theo lý thuyết về thực thi ký hiệu/concolic, giải ràng buộc bằng SMT mới xử lý tận gốc dạng điều kiện này, và dữ liệu của nhóm phù hợp với nhận định đó."));
add(H2("5.2. Bài học từ quá trình thực nghiệm"));
add(BUL("**Một lỗi có thể che lỗi khác.** ASan dừng ở lỗi đầu tiên. Nếu `studentId` không kết thúc bằng NUL, `strcpy` ở `parse_student_id()` tràn trước và mọi payload “kích hoạt nhánh magic” thực chất chỉ chứng minh BUG-01. Payload của BUG-02, 05, 06 phải được thiết kế để tránh lỗi này."));
add(BUL("**Tên lỗi theo thiết kế khác tên lỗi theo sanitizer.** BUG-05 là double-free nhưng log là heap-use-after-free; khi viết báo cáo cần ghi đúng cái log nói, rồi giải thích quan hệ."));
add(BUL("**Chữ ký lỗi cần chỉ lấy frame sau dòng `ERROR:`.** UBSan in stack trace trước lỗi ASan nên một phiên bản đầu của fuzzer gán nhầm UAF cho `telemetry_byte_counter`; nhóm đã sửa hàm `signature()` và phân loại lại các payload đã lưu bằng `reclassify.py`."));
add(H2("5.3. Hạn chế"));
add(BUL("**Quy mô nhỏ.** Mỗi chiến dịch 3.000 lần chạy, chỉ 3 seed; các con số first_run có phương sai lớn (ví dụ BUG-07: 7, 225, 130) nên không nên đọc là xếp hạng chính xác giữa các chiến lược."));
add(BUL("**White-box ở đây là coverage-guided cộng từ điển hằng số, không phải thực thi ký hiệu.** Hằng số được lấy bằng biểu thức chính quy từ mã nguồn C, chưa phân tích cây cú pháp hay thu thập ràng buộc đường đi. Z3 chỉ có trong script phụ, chưa dùng để tạo số liệu chính."));
add(BUL("**Độ phủ khối (trace-pc) khác độ phủ cạnh.** Đo bằng `-fsanitize-coverage=trace-pc` của GCC nên chỉ đếm khối cơ bản; `gcov` bổ sung độ phủ dòng và nhánh nhưng chỉ chạy trên corpus cuối, không theo thời gian."));
add(BUL("**Không có hang để phát hiện.** Chương trình mô phỏng không có vòng lặp phụ thuộc đầu vào; yêu cầu “crash/hang” của giảng viên vì vậy chỉ kiểm chứng được phía crash."));
add(BUL("**Một số đường mã không thể phủ bằng payload** (xử lý `malloc`/`fopen` thất bại), nên BUG-04 cần harness tiêm lỗi riêng, không do fuzzer tìm ra."));
add(BUL("**Mô phỏng khác hệ thống thật.** Mã C được viết có chủ đích chứa lỗi theo kịch bản; tần suất và hình dạng điều kiện của lỗi thật có thể khác. CVE ở Bảng 10 chỉ để minh họa lớp lỗi."));
add(BUL("**ASan dừng ở lỗi đầu tiên** nên mỗi lần chạy chỉ báo một lỗi; các lỗi sâu hơn trong cùng đường đi chỉ lộ sau khi lỗi đứng trước được vá."));
add(H2("5.4. Hướng cải thiện"));
add(BUL("Dùng Z3 để giải đồng thời các điều kiện hai tham số và thu thập ràng buộc từ AST (ví dụ bằng `clang -ast-dump` hoặc `pycparser`), đúng nghĩa concolic."));
add(BUL("Chạy cùng harness với AFL++ hoặc libFuzzer để có độ phủ cạnh và so sánh với fuzzer tự viết; tăng ngân sách lên hàng trăm nghìn lần chạy với nhiều seed hơn để có thống kê."));
add(BUL("Tách `parse_student_id()` thành đơn vị fuzz riêng (harness theo hàm) để tránh việc lỗi đầu tiên che các lỗi phía sau; thêm thao tác tiêm lỗi cấp phát (ví dụ `LD_PRELOAD`) để fuzz các đường lỗi môi trường."));

// ---------- 6. KẾT LUẬN ----------
add(H1("6. Kết luận"));
add(P("Báo cáo đã mô phỏng bảy điểm nóng an toàn của hệ thống quản lý thực tập sinh viên bằng chương trình C 308 dòng, xây dựng fuzzer white-box dùng phản hồi coverage với cơ chế cập nhật seed, và so sánh với black-box (toàn miền và bounded) trên cùng harness. Cả 7 lỗi (CWE-120 ×2, 401, 415, 416, 476, 190) được xác nhận bằng ASan/UBSan/LSan cùng payload cụ thể, và bản vá loại bỏ toàn bộ lỗi trên 79 payload."));
add(P("Về định lượng, white-box nâng độ phủ dòng từ khoảng 71% lên 89–92% và nhánh được đi từ 43–44% lên 65–69%, đồng thời tìm được 5–6/6 loại lỗi so với 2/6 của black-box. Kết quả cũng chỉ ra giới hạn: black-box nhanh hơn với lỗi dày, và điều kiện hai tham số vẫn cần giải ràng buộc đồng thời thay vì chỉ mutation. Quy trình “phát hiện → bằng chứng → vá → xác nhận lại” được thực hiện đầy đủ và có thể tái hiện bằng các script đi kèm."));

// ---------- 7. TÀI LIỆU THAM KHẢO ----------
add(H1("7. Tài liệu tham khảo"));
const refs = [
  "ThS. Vũ Quang Dũng, *Hướng dẫn Báo cáo Bài tập lớn*, CSE703093 – An toàn phần mềm, Trường Đại học Phenikaa, 2026.",
  "MITRE, “CWE-120: Buffer Copy without Checking Size of Input (‘Classic Buffer Overflow’)”, https://cwe.mitre.org/data/definitions/120.html.",
  "MITRE, “CWE-190: Integer Overflow or Wraparound”, https://cwe.mitre.org/data/definitions/190.html.",
  "MITRE, “CWE-401: Missing Release of Memory after Effective Lifetime”, https://cwe.mitre.org/data/definitions/401.html.",
  "MITRE, “CWE-415: Double Free”, https://cwe.mitre.org/data/definitions/415.html.",
  "MITRE, “CWE-416: Use After Free”, https://cwe.mitre.org/data/definitions/416.html.",
  "MITRE, “CWE-476: NULL Pointer Dereference”, https://cwe.mitre.org/data/definitions/476.html.",
  "NIST, National Vulnerability Database: CVE-2023-42801, CVE-2023-45664, CVE-2024-4741, CVE-2021-34798, CVE-2021-30860, CVE-2023-53017, https://nvd.nist.gov/vuln/detail/<CVE-ID> (tra cứu 19/10/2026).",
  "K. Serebryany, D. Bruening, A. Potapenko, D. Vyukov, “AddressSanitizer: A Fast Address Sanity Checker”, USENIX Annual Technical Conference, 2012.",
  "L. de Moura, N. Bjørner, “Z3: An Efficient SMT Solver”, TACAS 2008, LNCS 4963, pp. 337–340.",
  "P. Godefroid, M. Y. Levin, D. Molnar, “Automated Whitebox Fuzz Testing”, NDSS 2008.",
  "B. P. Miller, L. Fredriksen, B. So, “An Empirical Study of the Reliability of UNIX Utilities”, Communications of the ACM 33(12), 1990.",
  "Free Software Foundation, “Gcov – a Test Coverage Program”, GCC Manual, https://gcc.gnu.org/onlinedocs/gcc/Gcov.html.",
];
refs.forEach((r, i) => add(new Paragraph({ alignment: AlignmentType.LEFT, indent: { left: 540, hanging: 540 }, spacing: { after: 60, line: 300 },
  children: [new TextRun({ text: `[${i + 1}]\t`, font: FONT }), ...runs(r.replace(/\*([^*]+)\*/g, "$1"))], tabStops: [{ type: TabStopType.LEFT, position: 540 }] })));

// ---------- PHỤ LỤC ----------
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("Phụ lục"));
add(H2("A. Cấu trúc thư mục và cách tái hiện"));
add(...code([
  "fuzzing_internship/",
  "├── targets/   internship_parser.c, internship_parser_fixed.c, Makefile",
  "├── scripts/   common.py, evidence_run.py, cov_fuzz.py, run_campaigns.sh,",
  "│              reclassify.py, measure_gcov.py, regression_fixed.py,",
  "│              make_figures.py, cov_shim.c, gcov_shim.c, leak_harness.c,",
  "│              whitebox_fuzz.py (Z3), blackbox_fuzz.py",
  "├── build/     nhị phân sinh ra khi biên dịch",
  "└── out/       evidence/, fuzz/, fuzz_summary.json,",
  "               gcov_summary.json, figures/",
]));
add(...code([
  "# 1. Biên dịch",
  "mkdir -p build",
  "SAN=\"-g -O0 -fsanitize=address,undefined -fno-omit-frame-pointer\"",
  "gcc $SAN -o build/parser_asan targets/internship_parser.c",
  "gcc $SAN -o build/fixed_asan  targets/internship_parser_fixed.c",
  "gcc -c -O0 -o build/cov_shim.o scripts/cov_shim.c",
  "gcc -g -O0 -no-pie -fsanitize=address,undefined -fsanitize-coverage=trace-pc \\",
  "    -o build/parser_cov targets/internship_parser.c build/cov_shim.o",
  "# 2. Bằng chứng từng lỗi + bản fixed",
  "python3 scripts/evidence_run.py",
  "# 3. 9 chiến dịch fuzz (3000 lần/chiến dịch), ~25 phút trên 1 CPU",
  "RUNS=3000 scripts/run_campaigns.sh",
  "# 4. Phân loại lỗi, đo coverage, hồi quy bản fixed, vẽ hình",
  "python3 scripts/reclassify.py && python3 scripts/measure_gcov.py",
  "python3 scripts/regression_fixed.py && python3 scripts/make_figures.py",
  "# 5. (Tùy chọn) giải ràng buộc bằng Z3",
  "pip install z3-solver && python3 scripts/whitebox_fuzz.py",
]));
add(P("Lưu ý: `whitebox_fuzz.py` chạy bản không sanitizer `targets/internship_parser` (tạo bằng `make all`); muốn thấy log ASan cần đổi biến `TARGET` sang `build/parser_asan`."));
add(H2("B. Nội dung các payload gây lỗi (hex, theo định dạng 21 byte header + ID + dữ liệu thừa)"));
for (const f of ["BUG-02_overflow_magic_status", "BUG-03_null_deref_unlock", "BUG-05_double_free_close_session", "BUG-06_uaf_release_buffer", "BUG-07_int_overflow_telemetry"]) {
  add(P(`**${f}.bin**`, { keepNext: true, align: AlignmentType.LEFT, spacing: { after: 0 } }));
  add(...code(hexdump(f + ".bin"), 17));
}
add(P("Payload BUG-01 gồm header 21 byte (id_len = 0x40) theo sau là 64 byte 0x41 ('A'), xem `out/evidence/BUG-01_overflow_student_id.bin`."));
add(H2("C. Nhật ký ASan đầy đủ của BUG-01"));
add(...code(fs.readFileSync(path.join(EVI, "BUG-01_overflow_student_id.buggy.log"), "utf8").split("\n")
  .filter((l) => /ERROR|WRITE|^    #[0-3] |located in stack|\[128, 144\]|SUMMARY|This frame/.test(l))
  .map((l) => l.replace(/\.\.\/fuzzing_internship\/targets\//g, "").slice(0, 118)), 17));
add(H2("D. Mã nguồn"));
add(P("Toàn bộ mã nguồn (`targets/`, `scripts/`) và dữ liệu thực nghiệm (`out/`) được nộp kèm trong thư mục `fuzzing_internship/`, không đưa vào thân báo cáo để giữ báo cáo gọn theo hướng dẫn."));

// ====================== DOCUMENT ======================
const doc = new Document({
  creator: "Nhóm 12", title: "Báo cáo BTL – Fuzzing White-box cho Hệ thống Quản lý Thực tập Sinh viên",
  styles: {
    default: { document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 100 } } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: FONT, color: "1A4FA0" }, paragraph: { spacing: { before: 360, after: 160, line: 300 }, outlineLevel: 0, keepNext: true } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: FONT }, paragraph: { spacing: { before: 240, after: 100, line: 300 }, outlineLevel: 1, keepNext: true } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, italics: true, font: FONT }, paragraph: { spacing: { before: 180, after: 60, line: 300 }, outlineLevel: 2, keepNext: true } },
    ],
  },
  numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [
    { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1701, right: 1134 } } }, children: cover },
    { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1701, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 22 })] })] }) },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "MỤC LỤC", bold: true, size: 30, color: "1A4FA0", font: FONT })] }),
        new TableOfContents("Mục lục", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({ children: [new PageBreak()] }),
        ...body,
      ] },
  ],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUTFILE, b); console.log("written", OUTFILE, b.length); });
