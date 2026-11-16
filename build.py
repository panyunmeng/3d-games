#!/usr/bin/env python3
"""把 vendor 与 src 里的脚本内联进 src/shell.html，产出单文件 index.html。

为什么要内联：交付物要求「双击即玩」。file:// 下 type="module" 会被 CORS 拦，
所以只能走经典 <script>；再内联成一个文件，才能拷走就能玩、断网也能玩。

用法：
    python build.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SHELL = ROOT / "src" / "shell.html"
OUT = ROOT / "index.html"

PARTS = [
    ("/*__THREE_JS__*/", ROOT / "vendor" / "three.min.js"),
    ("/*__ROUNDED_JS__*/", ROOT / "vendor" / "RoundedBoxGeometry.js"),
    ("/*__CORE_JS__*/", ROOT / "src" / "core.js"),
    ("/*__GAME_JS__*/", ROOT / "src" / "game.js"),
]


def load(path: pathlib.Path, check_script_tag: bool = True) -> str:
    if not path.exists():
        sys.exit(f"[build] 缺少文件：{path}")
    text = path.read_text(encoding="utf-8")
    if check_script_tag and "</script" in text.lower():
        sys.exit(f"[build] {path.name} 含有 </script，无法安全内联")
    return text


def main() -> int:
    shell = load(SHELL, check_script_tag=False)
    out = shell
    sizes = []
    for placeholder, path in PARTS:
        if placeholder not in out:
            sys.exit(f"[build] 占位符 {placeholder} 不在 shell.html 里")
        content = load(path)
        out = out.replace(placeholder, content)
        sizes.append(f"{path.name} {len(content.encode('utf-8'))}")

    for placeholder, _ in PARTS:
        if placeholder in out:
            sys.exit(f"[build] 占位符 {placeholder} 没替换干净")

    OUT.write_text(out, encoding="utf-8")
    total = len(out.encode("utf-8"))
    print(f"[build] index.html {total} bytes  <- " + ", ".join(sizes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
