"""给已有的外刊原始提取结果补上「文章导读」与杂志版「难度评级」。

用法：
    python scripts/backfill-periodical-magazine.py \
        --raw ".cache/periodical-raw2" --files "periodical-files"

为什么需要它：早期提取只保留了词条与段落，杂志排版右上角的「文章导读」整段中文
被并进了词条例句字段。这里按 extract-periodical.py 里同一套规则重新读一遍原件，
把导读与难度评级写回原始 JSON，随后重跑 npm run build:periodical 即可。
解析不到导读的期次保持为空，不补写、不机翻。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import importlib.util

SPEC = importlib.util.spec_from_file_location(
    "extract_periodical", pathlib.Path(__file__).resolve().parent / "extract-periodical.py"
)
extract = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extract)

TARGET_KINDS = {"layout", "reading"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default=".cache/periodical-raw2")
    parser.add_argument("--files", default="periodical-files")
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parent.parent
    raw_dir = (root / args.raw).resolve()
    files_dir = (root / args.files).resolve()
    manifest = json.loads((raw_dir / "manifest.json").read_text(encoding="utf-8"))

    filled_intro = 0
    filled_stars = 0
    missing_source = 0

    for item in manifest["files"]:
        json_path = raw_dir / item["json"]
        entry = json.loads(json_path.read_text(encoding="utf-8"))
        if entry.get("kind") not in TARGET_KINDS:
            continue
        source = files_dir / entry["file"]
        if source.suffix.lower() != ".pdf" or not source.exists():
            missing_source += 1
            continue
        lines, _pages, _first = extract.pdf_lines(source)
        intro = extract.find_magazine_intro(lines)
        stars = extract.find_magazine_difficulty(lines)
        reading = entry.setdefault("reading", {})
        changed = False
        if intro and reading.get("magazineIntro") != intro:
            reading["magazineIntro"] = intro
            changed = True
            filled_intro += 1
        if stars and reading.get("magazineDifficulty") != stars:
            reading["magazineDifficulty"] = stars
            changed = True
            filled_stars += 1
        if changed:
            json_path.write_text(
                json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            print(f"{entry['kind']:8} {entry['file']}  导读 {len(intro)} 字  难度 {stars or '-'}")

    print(
        f"补写完成：导读 {filled_intro} 份 / 难度评级 {filled_stars} 份 / 原件缺失 {missing_source} 份"
    )


if __name__ == "__main__":
    main()
