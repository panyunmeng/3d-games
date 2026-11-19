#!/usr/bin/env python3
"""生成 10 关地图 JSON。

每关用「手绘参数」描述（矩形/线/对称），脚本负责展开成 26×26 字符网格并校验：
- 每行 26 字符、共 26 行
- 底部基地区（12~13 列、24~25 行）与出生点留空
结果是稳定可复现的数据文件，改关卡只改下面的 LEVELS。
"""

from __future__ import annotations

import json
import os
from typing import Callable

W = H = 26
EMPTY, BRICK, STEEL, WATER, FOREST = ".", "#", "S", "W", "F"


class Grid:
    def __init__(self) -> None:
        self.cells = [[EMPTY] * W for _ in range(H)]

    def rect(self, x0: int, z0: int, x1: int, z1: int, ch: str) -> None:
        for z in range(z0, z1 + 1):
            for x in range(x0, x1 + 1):
                if 0 <= x < W and 0 <= z < H:
                    self.cells[z][x] = ch

    def line_h(self, x0: int, x1: int, z: int, ch: str) -> None:
        self.rect(x0, z, x1, z, ch)

    def line_v(self, x: int, z0: int, z1: int, ch: str) -> None:
        self.rect(x, z0, x, z1, ch)

    def put(self, x: int, z: int, ch: str) -> None:
        if 0 <= x < W and 0 <= z < H:
            self.cells[z][x] = ch

    def mirror_x(self) -> None:
        for z in range(H):
            for x in range(W // 2):
                self.cells[z][W - 1 - x] = self.cells[z][x]

    def rows(self) -> list[str]:
        return ["".join(r) for r in self.cells]


def level_1(g: Grid) -> None:
    """训练场：少量掩体，开阔，教移动与射击。"""
    g.rect(4, 3, 8, 3, BRICK)
    g.rect(17, 3, 21, 3, BRICK)
    g.rect(11, 7, 14, 9, BRICK)
    g.rect(2, 12, 3, 13, STEEL)
    g.rect(22, 12, 23, 13, STEEL)
    g.line_v(6, 10, 14, BRICK)
    g.line_v(19, 10, 14, BRICK)
    g.line_h(9, 11, 16, BRICK)
    g.line_h(14, 16, 16, BRICK)


def level_2(g: Grid) -> None:
    """砖巷：纵向砖墙切出走廊，横向断墙做掩体。"""
    for x in (3, 8, 18, 23):
        g.line_v(x, 2, 9, BRICK)
    g.line_h(11, 14, 5, BRICK)
    for z in (13, 14):
        g.line_h(1, 6, z, BRICK)
        g.line_h(19, 24, z, BRICK)
    g.line_v(12, 12, 15, STEEL)
    g.line_v(13, 12, 15, STEEL)
    g.line_h(9, 10, 19, BRICK)
    g.line_h(15, 16, 19, BRICK)


def level_3(g: Grid) -> None:
    """双河：两道水带挡车不挡弹，桥口是必争点。"""
    g.rect(0, 7, 25, 8, WATER)
    g.rect(0, 16, 25, 17, WATER)
    # 桥（把水带打断）
    for cx in (4, 5, 12, 13, 20, 21):
        g.put(cx, 7, EMPTY)
        g.put(cx, 8, EMPTY)
        g.put(cx, 16, EMPTY)
        g.put(cx, 17, EMPTY)
    g.rect(2, 3, 5, 4, BRICK)
    g.rect(20, 3, 23, 4, BRICK)
    g.rect(9, 11, 16, 11, STEEL)
    g.rect(0, 20, 3, 21, FOREST)
    g.rect(22, 20, 25, 21, FOREST)


def level_4(g: Grid) -> None:
    """堡垒：中央钢堡 + 砖砌迷宫般的绕行。"""
    g.rect(9, 8, 16, 8, STEEL)
    g.rect(9, 8, 9, 15, STEEL)
    g.rect(16, 8, 16, 15, STEEL)
    g.rect(9, 15, 16, 15, STEEL)
    g.rect(11, 11, 14, 12, BRICK)  # 堡垒内的诱饵
    for z in (3, 4):
        g.line_h(3, 7, z, BRICK)
        g.line_h(18, 22, z, BRICK)
    g.line_v(2, 10, 16, BRICK)
    g.line_v(23, 10, 16, BRICK)
    g.line_h(3, 7, 19, BRICK)
    g.line_h(18, 22, 19, BRICK)


def level_5(g: Grid) -> None:
    """森林：树丛遮眼，适合伏击；中路开阔但无掩体。"""
    g.rect(2, 5, 6, 9, FOREST)
    g.rect(19, 5, 23, 9, FOREST)
    g.rect(2, 18, 6, 21, FOREST)
    g.rect(19, 18, 23, 21, FOREST)
    g.rect(11, 4, 14, 6, BRICK)
    g.rect(11, 18, 14, 20, BRICK)
    g.line_v(0, 12, 13, STEEL)
    g.line_v(25, 12, 13, STEEL)
    g.line_h(10, 15, 12, BRICK)


def level_6(g: Grid) -> None:
    """铁壁：两道钢墙只留窄口，逼玩家绕行或升级火力破钢。"""
    g.line_v(7, 2, 11, STEEL)
    g.line_v(18, 2, 11, STEEL)
    g.line_v(7, 15, 22, STEEL)
    g.line_v(18, 15, 22, STEEL)
    g.rect(0, 12, 5, 13, BRICK)
    g.rect(9, 12, 16, 13, BRICK)
    g.rect(20, 12, 25, 13, BRICK)
    g.rect(11, 3, 14, 4, FOREST)


def level_7(g: Grid) -> None:
    """迷宫：密集砖阵，打墙即是开局的必修课。"""
    for z in range(3, 21, 4):
        g.line_h(1, 11, z, BRICK)
        g.line_h(14, 24, z, BRICK)
    for x in range(3, 25, 4):
        g.line_v(x, 4, 8, BRICK)
        g.line_v((x + 2) % W, 16, 20, BRICK)
    g.rect(11, 11, 14, 12, STEEL)
    g.put(0, 0, EMPTY)


def level_8(g: Grid) -> None:
    """湖心：中央大湖，四角林岛，只能沿环道推进。"""
    g.rect(7, 7, 18, 16, WATER)
    g.rect(11, 10, 14, 13, FOREST)  # 湖中岛
    g.rect(0, 0, 2, 2, FOREST)
    g.rect(23, 0, 25, 2, FOREST)
    g.rect(0, 23, 2, 25, FOREST)
    g.rect(23, 23, 25, 25, FOREST)
    g.rect(4, 11, 5, 12, BRICK)
    g.rect(20, 11, 21, 12, BRICK)
    g.rect(12, 3, 13, 4, BRICK)


def level_9(g: Grid) -> None:
    """要塞：对称双堡 + 中央火力走廊。"""
    for x0 in (3, 18):
        g.rect(x0, 5, x0 + 4, 5, STEEL)
        g.rect(x0, 5, x0, 12, STEEL)
        g.rect(x0 + 4, 5, x0 + 4, 12, STEEL)
        g.rect(x0, 12, x0 + 4, 12, STEEL)
        g.rect(x0 + 1, 7, x0 + 3, 10, BRICK)
    g.line_h(0, 2, 16, BRICK)
    g.line_h(23, 25, 16, BRICK)
    g.rect(11, 15, 14, 15, BRICK)
    g.rect(0, 18, 1, 20, FOREST)
    g.rect(24, 18, 25, 20, FOREST)


def level_10(g: Grid) -> None:
    """终局：砖、钢、水、林全上，路线最少、压力最大。"""
    g.rect(0, 6, 25, 6, WATER)
    g.rect(0, 7, 25, 8, WATER)
    for cx in (2, 3, 11, 12, 21, 22):
        for z in (6, 7, 8):
            g.put(cx, z, EMPTY)
    g.rect(9, 11, 16, 11, BRICK)
    g.rect(9, 14, 16, 14, BRICK)
    g.rect(9, 11, 9, 14, BRICK)
    g.rect(16, 11, 16, 14, BRICK)
    g.rect(12, 12, 13, 13, FOREST)
    g.rect(1, 11, 3, 11, STEEL)
    g.rect(22, 11, 24, 11, STEEL)
    g.rect(4, 4, 5, 5, BRICK)
    g.rect(20, 4, 21, 5, BRICK)
    g.rect(0, 18, 3, 20, FOREST)
    g.rect(22, 18, 25, 20, FOREST)
    g.line_v(6, 15, 21, BRICK)
    g.line_v(19, 15, 21, BRICK)


LEVELS: list[tuple[int, str, Callable[[Grid], None], dict[str, int]]] = [
    (1, "训练场", level_1, {"normal": 9, "fast": 1, "armor": 0}),
    (2, "砖巷", level_2, {"normal": 7, "fast": 2, "armor": 1}),
    (3, "双河", level_3, {"normal": 6, "fast": 2, "armor": 2}),
    (4, "堡垒", level_4, {"normal": 5, "fast": 3, "armor": 2}),
    (5, "密林", level_5, {"normal": 5, "fast": 2, "armor": 3}),
    (6, "铁壁", level_6, {"normal": 4, "fast": 3, "armor": 3}),
    (7, "迷宫", level_7, {"normal": 4, "fast": 2, "armor": 4}),
    (8, "湖心", level_8, {"normal": 3, "fast": 3, "armor": 4}),
    (9, "要塞", level_9, {"normal": 3, "fast": 3, "armor": 4}),
    (10, "终局", level_10, {"normal": 3, "fast": 2, "armor": 5}),
]

ALLOWED = set("#SWF.")

# 玩家出生格与敌人刷新格（与 src/sim/constants.ts 保持一致）
PLAYER_SPAWN = (9, 24)
ENEMY_SPAWNS = [(0, 1), (12, 1), (25, 1)]
BASE_NEIGHBORS = [(12, 23), (13, 23)]


def reachable(rows: list[str], start: tuple[int, int]) -> set[tuple[int, int]]:
    """按「坦克半径 0.95 m 能站进该格」判定可走，4 邻接 BFS。"""
    seen = {start}
    stack = [start]
    while stack:
        cx, cz = stack.pop()
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, nz = cx + dx, cz + dz
            if not (0 <= nx < W and 0 <= nz < H):
                continue
            # 墙格不可走；相邻格也必须是空地才能让圆滑过去
            if rows[nz][nx] in "#SW":
                continue
            if (nx, nz) in seen:
                continue
            seen.add((nx, nz))
            stack.append((nx, nz))
    return seen


def check_connectivity(rows: list[str]) -> list[str]:
    errors: list[str] = []
    seen = reachable(rows, PLAYER_SPAWN)
    for sp in ENEMY_SPAWNS:
        if sp not in seen:
            errors.append(f"敌人刷新点 {sp} 与玩家出生点不连通")
    for bp in BASE_NEIGHBORS:
        if bp not in seen:
            errors.append(f"基地前哨 {bp} 与玩家出生点不连通")
    return errors


def main() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), "..", "src", "levels")
    os.makedirs(out_dir, exist_ok=True)
    index: list[dict[str, object]] = []
    connectivity_failures: list[int] = []
    for lid, name, fn, mix in LEVELS:
        g = Grid()
        fn(g)
        rows = g.rows()
        assert len(rows) == H, f"level {lid}: {len(rows)} rows"
        for i, row in enumerate(rows):
            assert len(row) == W, f"level {lid} row {i}: {len(row)} chars"
            assert set(row) <= ALLOWED, f"level {lid} row {i}: bad chars"
        # 底部基地与出生点留空（代码也会兜底清空，这里保证数据本身干净）
        for z in range(23, 26):
            for x in range(11, 15):
                rows[z] = rows[z][:x] + EMPTY + rows[z][x + 1 :]
        for x0 in (8, 15):
            for z in (23, 24):
                rows[z] = rows[z][:x0] + EMPTY + rows[z][x0 + 1 :]
        errs = check_connectivity(rows)
        if errs:
            print(f"!! 第 {lid} 关（{name}）连通性问题：")
            for e in errs:
                print(f"   - {e}")
            connectivity_failures.append(lid)
        data = {"id": lid, "name": name, "rows": rows, "mix": mix}
        path = os.path.join(out_dir, f"level{lid:02d}.json")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        index.append({"id": lid, "name": name, "file": f"level{lid:02d}.json"})
        print(f"level{lid:02d}.json  {name}  mix={mix}")

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"共 {len(LEVELS)} 关 -> {os.path.abspath(out_dir)}")
    if connectivity_failures:
        raise SystemExit(f"连通性检查失败: {connectivity_failures}")


if __name__ == "__main__":
    main()
