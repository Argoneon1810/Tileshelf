"""화면 시험에 쓰는 사진 두 장(tests/dev/lake.jpg, ribbon.jpg)을 윈도우 기본 배경화면에서 만든다.

Microsoft의 이미지라 저장소에는 넣지 않고(.gitignore), 각자 PC에 있는 원본을 줄여서 쓴다.
사용: 저장소 맨 위에서 `python tests/dev/make_wallpapers.py`
"""
from pathlib import Path

from PIL import Image

SRC = Path("C:/Windows/Web/Wallpaper")
OUT = Path(__file__).resolve().parent
for name, src in [("lake.jpg", SRC / "ThemeC" / "img29.jpg"), ("ribbon.jpg", SRC / "ThemeB" / "img25.jpg")]:
    Image.open(src).convert("RGB").resize((2560, 1600)).save(OUT / name, quality=85)
    print(OUT / name)
