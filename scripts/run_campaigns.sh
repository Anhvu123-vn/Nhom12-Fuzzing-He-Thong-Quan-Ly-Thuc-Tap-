#!/usr/bin/env bash
# Chạy 3 chiến lược x 3 seed, mỗi campaign 5000 lần thực thi. Mất ~15 phút trên 1 CPU.
cd "$(dirname "$0")"
RUNS=${RUNS:-5000}
for seed in 1 2 3; do
  for mode in blackbox bounded whitebox; do
    python3 cov_fuzz.py $mode $RUNS $seed
  done
done
echo DONE
