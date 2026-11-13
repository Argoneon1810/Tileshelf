#!/usr/bin/env python3
"""color-preset.md의 블루·장밋빛 토큰으로 Tileshelf 확장 PNG 아이콘(16/32/48/128)을 생성한다.

규격:
- icon128.png: Chrome 웹 스토어 권장 규격에 맞춰 중앙 96x96 본체 + 사방 16px 완전 투명(alpha=0) 여백.
- icon48.png, icon32.png, icon16.png: 툴바·확장 관리 화면에서 또렷하게 보이도록 소폭 여백만 둔 슈퍼샘플링 렌더링.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

# color-preset.md 바인딩 색상
PRIMARY_TOP = (76, 136, 211)      # #4c88d3 (Key/primary)
PRIMARY_BOT = (58, 117, 191)      # #3a75bf (버튼 채움)
TILE_LIGHT = (244, 247, 251)      # #f4f7fb (Glass light)
TILE_ACCENT = (225, 118, 161)     # #e176a1 (Secondary/accent 장밋빛)


def rounded_rect_sdf(x: float, y: float, cx: float, cy: float, hw: float, hh: float, r: float) -> float:
    """중심 (cx, cy), 반너비 hw, 반높이 hh, 모서리 반지름 r인 둥근 사각형의 부호 있는 거리(안쪽 음수)."""
    dx = abs(x - cx) - (hw - r)
    dy = abs(y - cy) - (hh - r)
    out_d = math.hypot(max(dx, 0.0), max(dy, 0.0))
    in_d = min(max(dx, dy), 0.0)
    return out_d + in_d - r


def mix_rgb(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[float, float, float]:
    t = max(0.0, min(1.0, t))
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def sample_unit_icon(u: float, v: float, aa_width: float) -> tuple[float, float, float, float]:
    """정규화 본체 좌표 (u, v) in [0, 1]^2 에서 안티앨리어싱이 적용된 (r, g, b, alpha[0..1])을 반환한다."""
    # 외곽 둥근 정사각형 플레이트: [0, 1]^2 전체가 본체 영역
    d_plate = rounded_rect_sdf(u, v, 0.5, 0.5, 0.5, 0.5, 0.225)
    plate_cov = max(0.0, min(1.0, 0.5 - d_plate / aa_width))
    if plate_cov <= 0.0:
        return (0.0, 0.0, 0.0, 0.0)

    bg_r, bg_g, bg_b = mix_rgb(PRIMARY_TOP, PRIMARY_BOT, v * 0.85 + u * 0.15)
    # 상단 가장자리 미세 하이라이트로 단정한 입체감 부여
    rim = max(0.0, 1.0 - abs(d_plate + 0.012) / 0.018) * max(0.0, 1.0 - v * 1.4) * 0.14
    bg_r = min(255.0, bg_r + (255.0 - bg_r) * rim)
    bg_g = min(255.0, bg_g + (255.0 - bg_g) * rim)
    bg_b = min(255.0, bg_b + (255.0 - bg_b) * rim)

    # 내부 3x3 타일 격자 (우하단 (2, 2) 타일은 장밋빛 보조색 포인트)
    centers = (0.27, 0.50, 0.73)
    tile_half = 0.084
    tile_radius = 0.042

    for row_idx, cy in enumerate(centers):
        for col_idx, cx in enumerate(centers):
            d_tile = rounded_rect_sdf(u, v, cx, cy, tile_half, tile_half, tile_radius)
            tile_cov = max(0.0, min(1.0, 0.5 - d_tile / aa_width))
            if tile_cov > 0.0:
                fg = TILE_ACCENT if (row_idx == 2 and col_idx == 2) else TILE_LIGHT
                bg_r = bg_r * (1.0 - tile_cov) + fg[0] * tile_cov
                bg_g = bg_g * (1.0 - tile_cov) + fg[1] * tile_cov
                bg_b = bg_b * (1.0 - tile_cov) + fg[2] * tile_cov

    return (bg_r, bg_g, bg_b, plate_cov)


def encode_rgba_png(size: int, rows: list[bytes]) -> bytes:
    raw_data = b"".join(rows)

    def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw_data, level=9)
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", idat) + png_chunk(b"IEND", b"")


def render_icon(size: int) -> bytes:
    # 128px은 스토어 규격(96x96 본체 + 사방 16px 투명 여백), 작은 크기는 툴바 시인성을 위해 얇은 여백만 둔다.
    if size == 128:
        pad = 16.0
    elif size == 48:
        pad = 3.0
    elif size == 32:
        pad = 2.0
    else:
        pad = 1.0

    body = size - 2.0 * pad
    ss = 4
    aa_width = 1.0 / (body * ss * 0.65)
    rows: list[bytes] = []

    for py in range(size):
        row = bytearray([0])  # Filter None
        for px in range(size):
            # 128x128의 바깥 16px 여백은 완전히 투명(alpha=0)으로 강제 고정
            if size == 128 and (px < 16 or px >= 112 or py < 16 or py >= 112):
                row.extend((0, 0, 0, 0))
                continue

            r_acc = g_acc = b_acc = a_acc = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    u = ((px + (sx + 0.5) / ss) - pad) / body
                    v = ((py + (sy + 0.5) / ss) - pad) / body
                    sr, sg, sb, sa = sample_unit_icon(u, v, aa_width)
                    r_acc += sr * sa
                    g_acc += sg * sa
                    b_acc += sb * sa
                    a_acc += sa

            samples = ss * ss
            out_a = round((a_acc / samples) * 255.0)
            if out_a <= 0 or a_acc <= 0.0:
                row.extend((0, 0, 0, 0))
            else:
                row.extend((
                    max(0, min(255, round(r_acc / a_acc))),
                    max(0, min(255, round(g_acc / a_acc))),
                    max(0, min(255, round(b_acc / a_acc))),
                    max(0, min(255, out_a)),
                ))
        rows.append(bytes(row))

    if size == 128:
        # 16px 여백 검증
        for py in range(128):
            rbytes = rows[py]
            for px in range(128):
                alpha = rbytes[1 + px * 4 + 3]
                if px < 16 or px >= 112 or py < 16 or py >= 112:
                    assert alpha == 0, f"128px 여백 침범: ({px}, {py}) alpha={alpha}"

    return encode_rgba_png(size, rows)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    icons_dir = root / "src" / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    for sz in (16, 32, 48, 128):
        target = icons_dir / f"icon{sz}.png"
        target.write_bytes(render_icon(sz))
        print(f"Generated {target.relative_to(root)} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
