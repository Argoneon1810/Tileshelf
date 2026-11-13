"""gradient-check.mjs가 남긴 화면들로 바로가기 이름 글자와 배경 사이의 대비를 잰다.

글자색은 newtab.css의 판 글자색이다 (어두운 판 #ebeff4, 밝은 판 #1d2229).
화면의 모든 픽셀을 배경 후보로 보고 가장 나쁜 대비를 찾는다. 잡음 무늬 한 점에 휘둘리지 않도록
5×5 평균을 낸 뒤 잰다 (글자 한 획이 그보다 넓다).

index.json 항목에 rects([[x0, y0, x1, y1], ...])가 있으면 그 사각형(바로가기 이름 자리) 안만 재고,
text가 있으면 그 색을 글자색으로 쓴다 (label-contrast.mjs가 남긴다).

사용: python tests/dev/gradient_stats.py <출력폴더> [--sheet 모아보기.png]
기준: 모든 경우 최저 대비 5.0:1 이상. 12.5px 글자의 WCAG AA는 4.5:1인데, 모니터 밝기·색 차이를
견디도록 0.5만큼 여유를 둔다. 하나라도 못 넘으면 종료 코드 1.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

TEXT = {"dark": "#ebeff4", "light": "#1d2229"}
NEED = 5.0


def rel_lum(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=float)


def box_blur(a, k=5):
    pad = k // 2
    p = np.pad(a, ((pad, pad), (pad, pad), (0, 0)), mode="edge")
    s = np.cumsum(np.cumsum(p, 0), 1)
    s = np.pad(s, ((1, 0), (1, 0), (0, 0)))
    return (s[k:, k:] - s[:-k, k:] - s[k:, :-k] + s[:-k, :-k]) / (k * k)


def main():
    out = Path(sys.argv[1])
    sheet_path = sys.argv[sys.argv.index("--sheet") + 1] if "--sheet" in sys.argv else None
    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    rows = []
    for item in index:
        img = np.asarray(Image.open(out / item["file"]).convert("RGB"), dtype=float)
        lum = rel_lum(box_blur(img))
        t = rel_lum(hex_rgb(item.get("text") or TEXT[item["mode"]]))
        hi, lo = np.maximum(lum, t), np.minimum(lum, t)
        ratio = (hi + 0.05) / (lo + 0.05)
        if item.get("rects"):
            vals = [ratio[y0:y1, x0:x1].min() for x0, y0, x1, y1 in item["rects"] if x1 > x0 and y1 > y0]
            worst = float(min(vals))
        else:
            worst = float(ratio.min())
        item.update(min=worst, mean_l=float(lum.mean()))
        rows.append(item)

    bad = [r for r in rows if r["min"] < NEED]
    for r in rows:
        mark = "✖" if r["min"] < NEED else "✔"
        tag = "미리 고른 색" if r["preset"] else "어려운 색"
        print(f"{mark} {r['mode']:5} #{r['hex']} {r['name']:<10} ({tag})  최저 대비 {r['min']:.2f}:1")
    print(f"\n{len(rows) - len(bad)}/{len(rows)} 통과 (기준 {NEED}:1)")

    if sheet_path:
        w, h = 288, 180
        cols = 6
        n = len(rows)
        sheet = Image.new("RGB", (cols * w, ((n + cols - 1) // cols) * (h + 22)), "white")
        draw = ImageDraw.Draw(sheet)
        try:
            font = ImageFont.truetype("malgun.ttf", 13)
        except OSError:
            font = ImageFont.load_default()
        for i, r in enumerate(rows):
            x, y = (i % cols) * w, (i // cols) * (h + 22)
            sheet.paste(Image.open(out / r["file"]).convert("RGB").resize((w, h)), (x, y))
            draw.text((x + 4, y + h + 3), f"{r['name']} · {r['mode']} · {r['min']:.1f}:1", fill="black", font=font)
        sheet.save(sheet_path)
        print("모아보기:", sheet_path)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
