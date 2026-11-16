#!/usr/bin/env python3
"""把 vendor/three.min.js 与 src/game.js 内联进 src/shell.html，产出单文件 index.html。

为什么要内联：交付物要求「双击即玩」。file:// 下 type="module" 会被 CORS 拦，
所以只能走经典 <script>；再内联才做到一个文件拷走就能玩、断网也能玩。
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SHELL = ROOT / "src" / "shell.html"
THREE = ROOT / "vendor" / "three.min.js"
GAME = ROOT / "src" / "game.js"
OUT = ROOT / "index.html"


def load(path: pathlib.Path, check_script_tag: bool = True) -> str:
    text = path.read_text(encoding="utf-8")
    if check_script_tag and "</script" in text.lower():
        sys.exit(f"[build] {path.name} 含有 </script，无法安全内联")
    return text


def main() -> int:
    shell = load(SHELL, check_script_tag=False)
    three = load(THREE)
    game = load(GAME)

    out = shell.replace("/*__THREE_JS__*/", three).replace("/*__GAME_JS__*/", game)
    if "__THREE_JS__" in out or "__GAME_JS__" in out:
        sys.exit("[build] 占位符未替换干净")

    OUT.write_text(out, encoding="utf-8")
    print(f"[build] index.html {len(out.encode('utf-8'))} bytes "
          f"(shell {len(shell.encode('utf-8'))} + three {len(three.encode('utf-8'))} "
          f"+ game {len(game.encode('utf-8'))})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
