# Makefile cho internship_parser (bản buggy + bản fixed)
CC       = gcc
CFLAGS   = -g -O0 -Wall
ASAN     = -fsanitize=address,undefined
TARGET   = internship_parser
FIXED    = internship_parser_fixed

.PHONY: all clean asan fixed test

all: $(TARGET) $(FIXED)

$(TARGET): internship_parser.c
	$(CC) $(CFLAGS) -o $@ $<

$(FIXED): internship_parser_fixed.c
	$(CC) $(CFLAGS) -o $@ $<

# Biên dịch với AddressSanitizer + UBSan để xác nhận crash thật
asan: internship_parser.c
	$(CC) $(CFLAGS) $(ASAN) -o $(TARGET)_asan $<

fixed-asan: internship_parser_fixed.c
	$(CC) $(CFLAGS) $(ASAN) -o $(FIXED)_asan $<

clean:
	rm -f $(TARGET) $(FIXED) $(TARGET)_asan $(FIXED)_asan

# Test nhanh với payload rỗng / ngắn
test: $(TARGET)
	@echo "=== Test empty ==="
	@echo -n "" | ./$(TARGET) || true
	@echo "=== Test short ==="
	@printf '\x00\x00\x00\x00' | ./$(TARGET) || true
	@echo "Done."
