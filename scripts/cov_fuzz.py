#!/usr/bin/env python3
"""
cov_fuzz.py – so sánh 3 chiến lược fuzzing trên CÙNG harness và CÙNG ngân sách số lần chạy:

  blackbox   : random toàn miền int32, không dùng phản hồi coverage
  bounded    : random trong "vùng bounded" (miền nghiệp vụ), không dùng phản hồi coverage
  whitebox   : coverage-guided; từ điển hằng số trích từ điều kiện rẽ nhánh trong mã nguồn,
               mutation theo trường của payload, giữ lại seed khi có khối cơ bản mới (cập nhật seed)

Target: build/parser_cov (ASan + UBSan + -fsanitize-coverage=trace-pc, shim ghi bitmap).
Cách dùng: python3 cov_fuzz.py <mode> <runs> <seed>
"""
import sys, os, re, json, time, random, struct, tempfile, hashlib
from pathlib import Path
from common import ROOT, BUILD, make_payload, run

MODE, RUNS, SEED = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
OUT = ROOT / "out" / "fuzz" / f"{MODE}_s{SEED}"
(OUT / "corpus").mkdir(parents=True, exist_ok=True)
rnd = random.Random(SEED)
BIN = BUILD / "parser_cov"

# ---------- phản hồi coverage (chỉ dùng để ĐO ở black-box, để DẪN ở white-box) ----------
covf = tempfile.NamedTemporaryFile(delete=False, prefix=f"cov_{MODE}_{SEED}_"); covf.write(b"\0" * 65536); covf.flush()
fh = open(covf.name, "r+b")
def execute(payload):
    fh.seek(0); fh.write(b"\0" * 65536); fh.flush()
    rc, err, hang = run(BIN, payload, env_extra={"COV_FILE": covf.name}, timeout=1.0)
    fh.seek(0); bm = fh.read(65536)
    return rc, err, hang, {i for i, b in enumerate(bm) if b}

def signature(err):
    """Chữ ký lỗi = loại lỗi + hàm đầu tiên thuộc internship_parser.c trong stack trace."""
    m = re.search(r"ERROR: (?:AddressSanitizer|LeakSanitizer): ([\w\-]+)", err)
    if m:
        # chỉ tìm frame SAU dòng ERROR (UBSan có thể in stack trace trước đó)
        f = re.search(r"in (\w+) \S*internship_parser\.c:(\d+)", err[m.end():])
        return f"ASan:{m.group(1)}@{f.group(1) if f else '?'}"
    m = re.search(r"internship_parser\.c:(\d+):\d+: runtime error: ([^:]*?)(?::|$)", err, re.M)
    if m: return f"UBSan:{m.group(2).strip()}@line{m.group(1)}"
    return None

# ---------- white-box: trích hằng số từ điều kiện rẽ nhánh trong mã nguồn ----------
def static_dictionary():
    src = (ROOT / "targets" / "internship_parser.c").read_text()
    defs = {}
    for name, val in re.findall(r"#define\s+(\w+)\s+(0x[0-9A-Fa-f]+|\d+)", src):
        defs[name] = int(val, 0)
    consts = set()
    for tok in re.findall(r"(?:==|>=|<=|>|<)\s*(0x[0-9A-Fa-f]+|\w+)\b", src):
        v = int(tok, 0) if re.fullmatch(r"0x[0-9A-Fa-f]+|\d+", tok) else defs.get(tok)
        if v is not None: consts.add(v)
    consts |= {defs[k] for k in ("MAGIC_UNLOCK_A", "MAGIC_UNLOCK_B", "MAGIC_STATUS", "TELEMETRY_LIMIT") if k in defs}
    out = set()
    for c in consts:
        out |= {c, c - 1, c + 1}
    out |= {0, 1, -1, 2**31 - 1, -2**31, 2**16, 255, 256}
    return sorted(out)

DICT = static_dictionary() if MODE == "whitebox" else []

def u32(x): return x & 0xFFFFFFFF
def s32(x):
    x &= 0xFFFFFFFF
    return x - 2**32 if x >= 2**31 else x

# payload dạng dict các trường → bytes
def unpack(p):
    if len(p) < 21: p = p + b"\0" * (21 - len(p))
    st, a, b, s, q, n = struct.unpack("<IiiiiB", p[:21])
    idb = p[21:21 + n]; extra = p[21 + n:]
    return dict(status=st, a=a, b=b, sent=s, queued=q, idb=idb, extra=extra)
def pack(f):
    idb = f["idb"][:255]
    return struct.pack("<IiiiiB", u32(f["status"]), s32(f["a"]), s32(f["b"]), s32(f["sent"]), s32(f["queued"]), len(idb)) + idb + f["extra"][:200]

def mutate(p):
    f = unpack(p)
    for _ in range(rnd.choice([1, 1, 2, 3])):
        k = rnd.choice(["status", "a", "b", "sent", "queued", "idb", "extra", "bytes"])
        if k in ("status", "a", "b", "sent", "queued"):
            r = rnd.random()
            if r < 0.5 and DICT: f[k] = rnd.choice(DICT)
            elif r < 0.75: f[k] = f[k] ^ (1 << rnd.randrange(32))
            else: f[k] = rnd.getrandbits(32)
        elif k == "idb":
            r = rnd.random()
            if r < 0.4: f["idb"] = f["idb"] + b"A" * rnd.randrange(1, 40)
            elif r < 0.6: f["idb"] = f["idb"][:rnd.randrange(0, len(f["idb"]) + 1)] + b"\0"
            else: f["idb"] = bytes(rnd.randrange(32, 127) for _ in range(rnd.randrange(0, 24))) + b"\0"
        elif k == "extra":
            r = rnd.random()
            f["extra"] = (b"B" * rnd.randrange(0, 80)) if r < 0.6 else bytes(rnd.getrandbits(8) for _ in range(rnd.randrange(0, 48)))
        else:
            q = bytearray(pack(f))
            if q: q[rnd.randrange(len(q))] ^= 1 << rnd.randrange(8)
            f = unpack(bytes(q))
    return pack(f)

def gen_blackbox():
    n = rnd.randrange(21, 120)
    return bytes(rnd.getrandbits(8) for _ in range(n))
def gen_bounded():
    """Sinh payload trong vùng biên / miền nghiệp vụ.
    Mục đích: kiểm tra vùng biên khi phát hiện lỗi, thu thập corpus thú vị
    rồi đưa cho whitebox để kiểm soát số lượng lỗi có thể có.
    """
    idb = bytes(rnd.randrange(32, 127) for _ in range(rnd.randrange(0, 32))) + b"\0"
    return pack(dict(status=rnd.randrange(0, 2**23), a=rnd.randrange(0, 10000), b=rnd.randrange(0, 10000),
                     sent=rnd.randrange(0, 2**31), queued=rnd.randrange(0, 2**31),
                     idb=idb, extra=bytes(rnd.randrange(32, 127) for _ in range(rnd.randrange(0, 48)))))

# ---------- vòng lặp chính ----------
# Seed ban đầu (input data của vòng chạy đầu tiên) – chỉ dùng cho whitebox:
#   seed_hop_le = make_payload()          → status=0,..., student_id="SV001\0", extra=rỗng
#   seed_ngan   = make_payload(...SV002)  → + extra=b"hello"
# Bounded: gen_bounded() sinh trong vùng biên miền nghiệp vụ; corpus thú vị
# từ bounded có thể được nạp bổ sung vào queue whitebox để kiểm soát không gian lỗi.
queue = [make_payload(), make_payload(student_id=b"SV002\0", extra=b"hello")] if MODE == "whitebox" else []
global_cov, findings, curve, states, hangs = set(), {}, [], set(), 0
n_new_seed = 0
t0 = time.time()
for i in range(1, RUNS + 1):
    if MODE == "whitebox":
        if i <= len(queue): p = queue[i - 1]
        else: p = mutate(rnd.choice(queue[-8:] if rnd.random() < 0.5 else queue))
    elif MODE == "bounded": p = gen_bounded()
    else: p = gen_blackbox()
    rc, err, hang, cov = execute(p)
    new = cov - global_cov
    if new:
        global_cov |= cov
        (OUT / "corpus" / f"id{n_new_seed:04d}.bin").write_bytes(p); n_new_seed += 1
        if MODE == "whitebox" and p not in queue: queue.append(p)       # cập nhật seed
    states.add(frozenset(cov))
    if hang: hangs += 1
    sig = signature(err)
    if sig and sig not in findings:
        findings[sig] = {"first_run": i, "rc": rc, "payload_hex": p.hex()}
        (OUT / f"finding_{len(findings):02d}_{sig.replace(':','_').replace('@','_')}.bin").write_bytes(p)
    if i % 250 == 0 or i == 1:
        curve.append({"run": i, "blocks": len(global_cov), "findings": len(findings), "seeds": n_new_seed})
res = {"mode": MODE, "runs": RUNS, "seed": SEED, "time_s": round(time.time() - t0, 1),
       "blocks": len(global_cov), "distinct_states": len(states), "corpus_seeds": n_new_seed,
       "hangs": hangs, "findings": findings, "curve": curve,
       "dict_size": len(DICT)}
(OUT / "result.json").write_text(json.dumps(res, indent=1))
print(MODE, SEED, "blocks", len(global_cov), "states", len(states), "findings", sorted(findings), "t", res["time_s"])
