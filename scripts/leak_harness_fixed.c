/* Harness minh họa CWE-401: ép malloc thất bại bằng msg_len khổng lồ. */
#define main target_main
#include "../targets/internship_parser_fixed.c"
#undef main
int main(void) {
    LogEntry *e = write_log_entry("AUTH_FAIL_LOG", (size_t)1 << 62);
    printf("write_log_entry returned %p\n", (void *)e);
    return 0;
}
