"""dist/newtab.html(빌드 결과)을 일반 웹 페이지로 띄울 수 있게 tests/dev/preview.html로 복사한다.

가짜 chrome API(chrome-shim.js)를 먼저 읽고, 배경 사진이 준비된 뒤 main.js를 불러온다.
사용: 저장소 맨 위에서 `npm run build`, `python tests/dev/make_preview.py` 후 `python -m http.server 8765`,
브라우저로 http://localhost:8765/tests/dev/preview.html 을 연다.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
src = (root / "dist" / "newtab.html").read_text(encoding="utf-8")
old = '<script type="module" src="js/main.js"></script>'
assert old in src, "newtab.html의 main.js 태그 모양이 바뀌었다"
new = (
    '<script src="/tests/dev/chrome-shim.js"></script>\n'
    '  <script type="module">await window.__bgReady; await import("/dist/js/main.js");</script>'
)
charset = '<meta charset="utf-8">'
assert charset in src
out = src.replace(old, new).replace(charset, charset + '\n  <base href="/dist/">', 1)
(root / "tests" / "dev" / "preview.html").write_text(out, encoding="utf-8")
print("tests/dev/preview.html")
