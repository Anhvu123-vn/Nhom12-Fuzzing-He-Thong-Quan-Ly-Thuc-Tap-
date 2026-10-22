/*
 * internship_parser_fixed.c
 * ---------------------------------------------------------------------------
 * Phiên bản đã vá các lỗi của internship_parser.c
 * Dùng để so sánh before/after trong báo cáo (bảng tổng hợp).
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

#define MAX_STUDENT_ID_LEN   16
#define MAX_PAYLOAD_LEN      64
#define SESSION_BUF_SIZE     32
#define LOG_ENTRY_SIZE       48
#define MAGIC_STATUS         0x494E54
#define MAGIC_UNLOCK_A       7421
#define MAGIC_UNLOCK_B       3390
#define TELEMETRY_LIMIT      2000000000

typedef struct {
    char     student_id[MAX_STUDENT_ID_LEN];
    uint32_t status_code;
    int32_t  credits;
    int32_t  sent_bytes;
    int32_t  queued_bytes;
} ApplicationRecord;

typedef struct {
    char  *buf;
    size_t len;
    int    refcount;
} SessionBuffer;

typedef struct {
    char  *message;
    size_t size;
    int    written;
} LogEntry;

static SessionBuffer *g_session = NULL;
static LogEntry      *g_log     = NULL;
static int            g_session_open_count = 0;
static uint64_t       g_total_telemetry   = 0;

/* 1. FIXED: strncpy + null-terminate */
void parse_student_id(const char *raw_id, size_t raw_len, char *out_id)
{
    size_t n = (raw_len < MAX_STUDENT_ID_LEN - 1) ? raw_len : (MAX_STUDENT_ID_LEN - 1);
    memcpy(out_id, raw_id, n);
    out_id[n] = '\0';
}

/* 2. FIXED: free entry khi malloc message thất bại */
LogEntry *write_log_entry(const char *msg, size_t msg_len)
{
    LogEntry *entry = (LogEntry *)malloc(sizeof(LogEntry));
    if (!entry) return NULL;

    entry->message = (char *)malloc(msg_len + 1);
    if (!entry->message) {
        free(entry);                    /* FIX CWE-401 */
        return NULL;
    }
    memcpy(entry->message, msg, msg_len);
    entry->message[msg_len] = '\0';
    entry->size    = msg_len;
    entry->written = 1;
    return entry;
}

/* 3. FIXED: chỉ free một lần, caller chịu trách nhiệm NULL */
void close_session(SessionBuffer *sess)
{
    if (!sess) return;
    if (sess->buf) {
        free(sess->buf);
        sess->buf = NULL;
    }
    free(sess);
}

/* 4. FIXED: không ghi sau free */
void release_session_buffer(SessionBuffer *sess)
{
    if (!sess) return;
    if (sess->buf) {
        free(sess->buf);
        sess->buf = NULL;
    }
    sess->len = 0;
    free(sess);
}

/* 5. FIXED: kiểm tra độ dài trước memcpy */
int check_status_magic(uint32_t status_code, const char *payload, size_t plen)
{
    if (status_code == MAGIC_STATUS) {
        char local[16];
        size_t n = (plen < sizeof(local) - 1) ? plen : (sizeof(local) - 1);
        if (n > 0) {
            memcpy(local, payload, n);
            local[n] = '\0';
        }
        return 1;
    }
    return 0;
}

/* 6. FIXED: không NULL-deref, chỉ trả về mã lỗi */
int device_unlock_code(int code_a, int code_b)
{
    if (code_a == MAGIC_UNLOCK_A && code_b == MAGIC_UNLOCK_B) {
        return 1;   /* đạt điều kiện, không crash */
    }
    return 0;
}

/* 7. FIXED: kiểm tra tràn trước khi cộng */
int telemetry_byte_counter(int32_t sent, int32_t queued)
{
    if (sent < 0 || queued < 0) return -2;
    /* Kiểm tra tràn an toàn */
    if (sent > TELEMETRY_LIMIT - queued) {
        return -1;  /* sẽ tràn */
    }
    int32_t total = sent + queued;
    g_total_telemetry += (uint64_t)total;
    return total;
}

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

int process_application_payload(const uint8_t *data, size_t len)
{
    if (len < 21) return -1;

    uint32_t status_code;
    int32_t  code_a, code_b, sent, queued;
    uint8_t  id_len;

    memcpy(&status_code, data + 0, 4);
    memcpy(&code_a,      data + 4, 4);
    memcpy(&code_b,      data + 8, 4);
    memcpy(&sent,        data + 12, 4);
    memcpy(&queued,      data + 16, 4);
    id_len = data[20];

    char student_id[MAX_STUDENT_ID_LEN];
    memset(student_id, 0, sizeof(student_id));
    size_t copy_len = (id_len < len - 21) ? id_len : (len - 21);
    if (copy_len > 0) {
        parse_student_id((const char *)(data + 21), copy_len, student_id);
    }

    const uint8_t *rest = data + 21 + id_len;
    size_t rest_len = (len > 21 + id_len) ? (len - 21 - id_len) : 0;
    check_status_magic(status_code, (const char *)rest, rest_len);

    device_unlock_code(code_a, code_b);
    telemetry_byte_counter(sent, queued);

    g_session = allocate_session(SESSION_BUF_SIZE);
    if (g_session && rest_len > 0 && rest_len < SESSION_BUF_SIZE) {
        memcpy(g_session->buf, rest, rest_len);
        g_session->len = rest_len;
    }

    g_log = write_log_entry((const char *)data, len > 32 ? 32 : len);

    /* Không còn double-free / UAF */
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
