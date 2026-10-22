/* Shim đo phủ khối cơ bản (basic-block) cho fuzzer coverage-guided.
 * Biên dịch target với -fsanitize-coverage=trace-pc; mỗi khối ghi 1 byte vào bitmap
 * mmap chia sẻ (file COV_FILE) nên dữ liệu còn nguyên ngay cả khi ASan abort. */
#include <stdint.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
static volatile uint8_t *map;
__attribute__((constructor)) static void cov_init(void) {
    const char *p = getenv("COV_FILE");
    if (!p) return;
    int fd = open(p, O_RDWR);
    if (fd < 0) return;
    map = mmap(0, 65536, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (map == MAP_FAILED) map = 0;
}
void __sanitizer_cov_trace_pc(void) {
    if (!map) return;
    uintptr_t pc = (uintptr_t)__builtin_return_address(0);
    map[(pc * 2654435761u >> 8) & 0xFFFF] = 1;
}
