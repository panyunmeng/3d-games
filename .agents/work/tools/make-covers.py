"""把各游戏现有的验收截图裁成统一比例的封面（800x500，JPEG q82）。

为什么复用既有截图而不是重新拍：这些图是各游戏验收时留下的证据，
内容是真实画面；重新截图只会多一次「这台机器现在的显存/驱动状态」变量。
裁剪策略固定为「居中偏上」——游戏截图的主体通常在画面上半部分。
"""
from PIL import Image
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "portal" / "covers"
OUT.mkdir(parents=True, exist_ok=True)

SRC = {
    "snake":       ("3D经典贪吃蛇/docs/screenshots/menu.jpg", 0.42),
    "tetris":      ("3D俄罗斯方块/.agents/work/visual/20261117-gameplay.png", 0.45),
    "breakout":    ("3D打砖块/.agents/work/visual/20261117-demo-fx.png", 0.5),
    "minesweeper": ("3D扫雷/docs/screenshot.png", 0.45),
    "sokoban":     ("3D推箱子/.agents/work/3d-sokoban/20261117-build/01-level1-first.png", 0.5),
    "td":          ("3D塔防/docs/screenshots/02-battle.png", 0.42),
    "tank":        ("3D坦克大战/docs/images/gameplay.png", 0.42),
}

W, H = 800, 500
TARGET = W / H

for name, (rel, anchor) in SRC.items():
    p = ROOT / rel
    if not p.exists():
        print(f"SKIP {name}: {rel} 不存在")
        continue
    im = Image.open(p).convert("RGB")
    w, h = im.size
    ratio = w / h
    if ratio > TARGET:
        nw = int(h * TARGET)
        left = (w - nw) // 2
        box = (left, 0, left + nw, h)
    else:
        nh = int(w / TARGET)
        top = int((h - nh) * anchor)
        box = (0, top, w, top + nh)
    im = im.crop(box).resize((W, H), Image.LANCZOS)
    out = OUT / f"{name}.jpg"
    im.save(out, "JPEG", quality=82, optimize=True, progressive=True)
    print(f"{name:12s} {p.name:40s} {im.size} -> {out.stat().st_size//1024} KB")
