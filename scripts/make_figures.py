#!/usr/bin/env python3
"""Vẽ sơ đồ luồng dữ liệu và đồ thị coverage theo số lần chạy."""
import json, glob
from pathlib import Path
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
ROOT = Path(__file__).resolve().parent.parent
FIG = ROOT / "out" / "figures"; FIG.mkdir(parents=True, exist_ok=True)

def box(ax, x, y, w, h, text, fc="#E8F0FE", ec="#1A4FA0", fs=9):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02", fc=fc, ec=ec, lw=1.3))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs)
def arrow(ax, x1, y1, x2, y2):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="->", mutation_scale=12, lw=1.2, color="#333"))

# --- Hình 1: kiến trúc / luồng dữ liệu ---
fig, ax = plt.subplots(figsize=(9, 4.6)); ax.set_xlim(0, 10); ax.set_ylim(0, 5.2); ax.axis("off")
box(ax, 0.1, 2.2, 1.7, 0.9, "API request\n(studentId, status,\npayload)\n[NestJS]", "#FFF4D6", "#B07A00")
box(ax, 2.1, 2.2, 2.4, 0.9, "File payload nhị phân\n(header 21 byte + ID + extra)\nargv[1] / stdin", "#FFF4D6", "#B07A00", 8.5)
box(ax, 4.8, 2.0, 2.3, 1.3, "process_application_payload()\ntách trường: status, code_a,\ncode_b, sent, queued, id_len", "#E8F0FE")
arrow(ax, 1.8, 2.65, 2.1, 2.65); arrow(ax, 4.5, 2.65, 4.8, 2.65)
box(ax, 7.6, 4.0, 2.3, 0.75, "parse_student_id()\nCWE-120", "#FDE8E8", "#B00020")
box(ax, 7.6, 3.1, 2.3, 0.75, "check_status_magic()\nCWE-120 (status=0x494E54)", "#FDE8E8", "#B00020")
box(ax, 7.6, 2.2, 2.3, 0.75, "device_unlock_code()\nCWE-476 (7421, 3390)", "#FDE8E8", "#B00020")
box(ax, 7.6, 1.3, 2.3, 0.75, "telemetry_byte_counter()\nCWE-190", "#FDE8E8", "#B00020")
box(ax, 7.6, 0.2, 2.3, 0.95, "write_log_entry() CWE-401\nclose_session() CWE-415\nrelease_session_buffer()\nCWE-416", "#FDE8E8", "#B00020", 7.5)
for y in (4.37, 3.47, 2.57, 1.67, 0.67): arrow(ax, 7.1, 2.65, 7.6, y)
ax.text(5.85, 4.9, "Attack surface: toàn bộ byte của file payload do bên ngoài kiểm soát", ha="center", fontsize=9, style="italic")
fig.tight_layout(); fig.savefig(FIG / "fig1_architecture.png", dpi=170); plt.close(fig)

# --- Hình 2: coverage theo số lần chạy ---
res = {}
for f in glob.glob(str(ROOT / "out" / "fuzz" / "*" / "result.json")):
    r = json.load(open(f)); res.setdefault(r["mode"], []).append(r)
if res:
    fig, ax = plt.subplots(figsize=(7.5, 4))
    style = {"blackbox": ("#888888", "Black-box (toàn miền)"), "bounded": ("#E08A00", "Black-box (bounded)"), "whitebox": ("#1A4FA0", "White-box (coverage-guided)")}
    for mode, rs in res.items():
        for i, r in enumerate(rs):
            xs = [c["run"] for c in r["curve"]]; ys = [c["blocks"] for c in r["curve"]]
            ax.plot(xs, ys, color=style[mode][0], alpha=0.85, lw=1.6, label=style[mode][1] if i == 0 else None)
    ax.set_xlabel("Số lần thực thi"); ax.set_ylabel("Số khối cơ bản đã phủ (trace-pc)")
    ax.grid(alpha=.3); ax.legend(); fig.tight_layout(); fig.savefig(FIG / "fig2_coverage_curve.png", dpi=170); plt.close(fig)
print("figures ok")
