/*
 * internship_parser.c
 * ---------------------------------------------------------------------------
 * Mô phỏng các điểm nóng an toàn của Hệ thống Quản lý Thực tập Sinh viên
 * (quan-ly-thuc-tap) phục vụ White-box / Black-box Fuzzing (CSE703093 - Nhóm 12)
 *
 * Các kịch bản được mô phỏng:
 *   1. Parse student_id / application payload  →  CWE-120 (buffer overflow)
 *   2. Cấp phát & giải phóng session/log entry →  CWE-401 / CWE-415 / CWE-416
 *   3. Kiểm tra mã trạng thái đặc biệt (magic) →  nhánh khó tìm bằng random
 *   4. Bộ đếm telemetry byte (int32 overflow)  →  CWE-190
 *
 * Biên dịch (có ASan để xác nhận crash thật):
 *   gcc -g -O0 -fsanitize=address,undefined -o internship_parser internship_parser.c
 *
 * Chạy với input từ file hoặc stdin (dùng cho fuzzer):
 *   ./internship_parser < payload.bin
 *   ./internship_parser payload.bin
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

/* ---------- Hằng số mô phỏng ràng buộc hệ thống ---------- */
#define MAX_STUDENT_ID_LEN   16   /* CON-2: ID tối đa 16 ký tự ASCII */
#define MAX_PAYLOAD_LEN      64
#define SESSION_BUF_SIZE     32
#define LOG_ENTRY_SIZE       48
#define MAGIC_STATUS         0x494E54 /* 'INT' – mã trạng thái đặc biệt (interview) */
#define MAGIC_UNLOCK_A       7421
#define MAGIC_UNLOCK_B       3390
#define TELEMETRY_LIMIT      2000000000  /* ngưỡng tràn int32 */

/* ---------- Cấu trúc dữ liệu mô phỏng ---------- */
typedef struct {
    char     student_id[MAX_STUDENT_ID_LEN];
    uint32_t status_code;
    int32_t  credits;
    int32_t  sent_bytes;
    int32_t  queued_bytes;
} ApplicationRecord;

typedef struct {
    char  *buf;          /* cấp phát động – dễ leak / double-free / UAF */
    size_t len;
    int    refcount;
} SessionBuffer;

typedef struct {
    char  *message;
    size_t size;
    int    written;
} LogEntry;

/* ---------- Biến toàn cục mô phỏng trạng thái gateway ---------- */
static SessionBuffer *g_session = NULL;
static LogEntry      *g_log     = NULL;
static int            g_session_open_count = 0;
static uint64_t       g_total_telemetry   = 0;

/* ================================================================
 * 1. parse_student_id  –  CWE-120 Buffer Overflow
 *    Sao chép raw_id vào buffer cố định 16 byte KHÔNG kiểm tra độ dài.
 *    Đây là lỗi điển hình khi nhận payload từ frontend/API.
 * ================================================================ */
void parse_student_id(const char *raw_id, size_t raw_len, char *out_id)
{
    /* BUG có chủ đích: strcpy không giới hạn → overflow khi raw_len > 15 */
    strcpy(out_id, raw_id);          /* CWE-120 */

    /* Phiên bản an toàn (comment để fuzzer tìm lỗi):
     * strncpy(out_id, raw_id, MAX_STUDENT_ID_LEN - 1);
     * out_id[MAX_STUDENT_ID_LEN - 1] = '\0';
     */
}

/* ================================================================
 * 2. write_log_entry  –  CWE-401 Memory Leak
 *    Cấp phát bộ nhớ cho message nhưng KHÔNG giải phóng khi lỗi.
 * ================================================================ */
LogEntry *write_log_entry(const char *msg, size_t msg_len)
{
    LogEntry *entry = (LogEntry *)malloc(sizeof(LogEntry));
    if (!entry) return NULL;

    entry->message = (char *)malloc(msg_len + 1);
    if (!entry->message) {
        /* BUG: quên free(entry) → memory leak (CWE-401) */
        return NULL;
    }
    memcpy(entry->message, msg, msg_len);
    entry->message[msg_len] = '\0';
    entry->size    = msg_len;
    entry->written = 1;
    return entry;
}

/* ================================================================
 * 3. close_session  –  CWE-415 Double Free
 *    Giải phóng session buffer. Nếu gọi 2 lần trên cùng con trỏ → double-free.
 * ================================================================ */
void close_session(SessionBuffer *sess)
{
    if (!sess) return;

    if (sess->buf) {
        free(sess->buf);
        sess->buf = NULL;          /* đúng cách nên để NULL */
    }
    free(sess);
    /* BUG cố ý: không đặt g_session = NULL ở đây, caller có thể free lại */
}

/* ================================================================
 * 4. release_session_buffer  –  CWE-416 Use-After-Free
 *    Sau khi free, vẫn ghi vào con trỏ cũ.
 * ================================================================ */
void release_session_buffer(SessionBuffer *sess)
{
    if (!sess) return;
    free(sess->buf);
    /* BUG: tiếp tục ghi sau free → Use-After-Free (CWE-416) */
    sess->buf[0] = 'X';
    sess->len = 0;
    free(sess);
}

/* ================================================================
 * 5. check_status_magic  –  nhánh “magic value” khó tìm bằng black-box
 *    Chỉ khi status_code == MAGIC_STATUS mới vào nhánh nguy hiểm.
 * ================================================================ */
int check_status_magic(uint32_t status_code, const char *payload, size_t plen)
{
    if (status_code == MAGIC_STATUS) {
        /* Nhánh mục tiêu: copy payload vào buffer nhỏ hơn → overflow */
        char local[16];
        if (plen > 0) {
            memcpy(local, payload, plen);   /* CWE-120 khi plen > 16 */
            local[15] = '\0';
        }
        return 1;   /* đạt mục tiêu */
    }
    return 0;
}

/* ================================================================
 * 6. device_unlock_code  –  magic pair (giống REQ-9 / template IoT)
 *    Chỉ crash khi đúng cặp (7421, 3390) – không gian quá lớn cho random.
 * ================================================================ */
int device_unlock_code(int code_a, int code_b)
{
    if (code_a == MAGIC_UNLOCK_A && code_b == MAGIC_UNLOCK_B) {
        /* Cố ý gây crash để fuzzer phát hiện */
        char *p = NULL;
        *p = 42;                /* NULL dereference – dễ thấy với ASan */
        return 1;
    }
    return 0;
}

/* ================================================================
 * 7. telemetry_byte_counter  –  CWE-190 Integer Overflow
 * ================================================================ */
int telemetry_byte_counter(int32_t sent, int32_t queued)
{
    /* Không kiểm tra tràn trước khi cộng */
    int32_t total = sent + queued;          /* CWE-190 */
    g_total_telemetry += (uint64_t)total;
    if (total > TELEMETRY_LIMIT) {
        return -1;  /* overflow detected (nhưng đã quá muộn) */
    }
    return total;
}

/* ================================================================
 * 8. allocate_session  –  cấp phát session buffer
 * ================================================================ */
SessionBuffer *allocate_session(size_t size)
{
    SessionBuffer *s = (SessionBuffer *)malloc(sizeof(SessionBuffer));
    if (!s) return NULL;
    s->buf = (char *)malloc(size);
    if (!s->buf) {
        free(s);
        return NULL;
    }
    memset(s->buf, 0, size);
    s->len = size;
    s->refcount = 1;
    g_session_open_count++;
    return s;
}

/* ================================================================
 * Hàm xử lý payload chính – điểm vào của fuzzer
 * Định dạng payload (binary):
 *   [0..3]   : uint32 status_code
 *   [4..7]   : int32  code_a
 *   [8..11]  : int32  code_b
 *   [12..15] : int32  sent_bytes
 *   [16..19] : int32  queued_bytes
 *   [20]     : uint8  student_id_len
 *   [21..]   : student_id (raw bytes)
 *   [..]     : payload còn lại (cho log / magic copy)
 * ================================================================ */
int process_application_payload(const uint8_t *data, size_t len)
{
    if (len < 21) return -1;   /* quá ngắn */

    uint32_t status_code;
    int32_t  code_a, code_b, sent, queued;
    uint8_t  id_len;

    memcpy(&status_code, data + 0, 4);
    memcpy(&code_a,      data + 4, 4);
    memcpy(&code_b,      data + 8, 4);
    memcpy(&sent,        data + 12, 4);
    memcpy(&queued,      data + 16, 4);
    id_len = data[20];

    /* --- 1. Parse student ID (có thể overflow) --- */
    char student_id[MAX_STUDENT_ID_LEN];
    memset(student_id, 0, sizeof(student_id));
    size_t copy_len = (id_len < len - 21) ? id_len : (len - 21);
    if (copy_len > 0) {
        parse_student_id((const char *)(data + 21), copy_len, student_id);
    }

    /* --- 2. Kiểm tra magic status --- */
    const uint8_t *rest = data + 21 + id_len;
    size_t rest_len = (len > 21 + id_len) ? (len - 21 - id_len) : 0;
    check_status_magic(status_code, (const char *)rest, rest_len);

    /* --- 3. Unlock code (magic pair) --- */
    device_unlock_code(code_a, code_b);

    /* --- 4. Telemetry counter --- */
    telemetry_byte_counter(sent, queued);

    /* --- 5. Session + Log lifecycle (leak / double-free / UAF) --- */
    g_session = allocate_session(SESSION_BUF_SIZE);
    if (g_session) {
        if (rest_len > 0 && rest_len < SESSION_BUF_SIZE) {
            memcpy(g_session->buf, rest, rest_len);
            g_session->len = rest_len;
        }
    }

    g_log = write_log_entry((const char *)data, len > 32 ? 32 : len);

    /* Cố ý tạo đường dẫn double-free / UAF khi status đặc biệt */
    if (status_code == MAGIC_STATUS && g_session) {
        close_session(g_session);
        /* BUG: gọi lại → double-free */
        close_session(g_session);
        g_session = NULL;
    }

    if (status_code == 0xDEAD && g_session) {
        release_session_buffer(g_session);  /* UAF */
        g_session = NULL;
    }

    /* Dọn dẹp bình thường */
    if (g_log) {
        free(g_log->message);
        free(g_log);
        g_log = NULL;
    }
    if (g_session) {
        free(g_session->buf);
        free(g_session);
        g_session = NULL;
    }

    return 0;
}

/* ================================================================
 * main – đọc input từ file hoặc stdin
 * ================================================================ */
int main(int argc, char *argv[])
{
    uint8_t buffer[512];
    size_t  nread = 0;

    if (argc >= 2) {
        FILE *fp = fopen(argv[1], "rb");
        if (!fp) {
            perror("fopen");
            return 1;
        }
        nread = fread(buffer, 1, sizeof(buffer), fp);
        fclose(fp);
    } else {
        nread = fread(buffer, 1, sizeof(buffer), stdin);
    }

    if (nread == 0) {
        fprintf(stderr, "Empty input\n");
        return 1;
    }

    return process_application_payload(buffer, nread);
}
