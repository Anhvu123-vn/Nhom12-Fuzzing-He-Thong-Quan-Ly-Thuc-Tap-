#!/usr/bin/env python3
"""Chạy lại các payload 'finding_*.bin' của mọi campaign và gán nhãn lỗi theo hàm signature() đã sửa."""
import sys, re, json, glob, importlib.util
from pathlib import Path
from common import ROOT, BUILD, run

def signature(err):
    m = re.search(r"ERROR: (?:AddressSanitizer|LeakSanitizer): ([\w\-]+)", err)
    if m:
        f = re.search(r"in (\w+) \S*internship_parser\.c:(\d+)", err[m.end():])
        return f"ASan:{m.group(1)}@{f.group(1) if f else '?'}"
    m = re.search(r"internship_parser\.c:(\d+):\d+: runtime error: ([^:]*?)(?::|$)", err, re.M)
    if m: return f"UBSan:{m.group(2).strip()}@line{m.group(1)}"
    return None

table = {}
for d in sorted(glob.glob(str(ROOT / "out" / "fuzz" / "*_s*"))):
    d = Path(d); res = json.load(open(d / "result.json"))
    sigs = {}
    # mỗi finding đã lưu = payload đầu tiên chạm chữ ký cũ; chạy lại để lấy chữ ký đúng.
    for name, info in res["findings"].items():
        rc, err, _ = run(BUILD / "parser_asan", bytes.fromhex(info["payload_hex"]))
        # UBSan 'signed integer overflow' không abort -> lỗi ASan đi sau mới là lỗi tiếp theo
        sigs.setdefault(signature(err) or name, info["first_run"])
        if "runtime error: signed integer overflow" in err:
            sigs.setdefault("UBSan:signed integer overflow@line170", info["first_run"])
    table[d.name] = {"blocks": res["blocks"], "states": res["distinct_states"], "seeds": res["corpus_seeds"],
                     "hangs": res["hangs"], "time_s": res["time_s"], "findings_fixed": sigs}
Path(ROOT / "out" / "fuzz_summary.json").write_text(json.dumps(table, indent=1, ensure_ascii=False))
for k, v in table.items():
    print(k, v["blocks"], v["states"], len(v["findings_fixed"]), sorted(v["findings_fixed"]))
