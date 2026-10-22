/* Khi target crash (SIGSEGV/SIGABRT), vẫn ghi dữ liệu gcov trước khi thoát. */
#include <signal.h>
#include <unistd.h>
extern void __gcov_dump(void);
static void on_sig(int s) { (void)s; __gcov_dump(); _exit(1); }
__attribute__((constructor)) static void install(void) {
    signal(SIGSEGV, on_sig); signal(SIGABRT, on_sig); signal(SIGBUS, on_sig);
}
