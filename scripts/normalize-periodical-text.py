"""Normalise extracted periodical text: drop page watermarks, fold odd glyphs.

PDF text layers in this library carry two kinds of noise:

* the public-account watermark that the source PDFs stamp on every page
  (``公众号：经济学人考研英语``), which ends up glued into sentences;
* compatibility glyphs such as the Kangxi radical ``⼈`` (U+2F08) instead of
  ``人``, which breaks search and looks wrong on the page.

Targeted folding plus a watermark strip fixes both without touching real content:
whole-string NFKC would also turn Chinese full-width punctuation (``，。：``) into
half-width ASCII, which reads badly on the page.
The original JSON stays untouched unless ``--write`` is passed.

用法:
    python scripts/normalize-periodical-text.py            # 预演
    python scripts/normalize-periodical-text.py --write    # 写回
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import unicodedata

# 只清理带品牌的整串水印，避免误删正文里正常出现的“微信/公众号”字样。
WATERMARK = re.compile(
    r"(?:关注)?(?:微信公众号|公众号)\s*[:：]?\s*经济学[人⼈]考研英语\s*"
    r"|经济学[人⼈]考研英语\s*"
)
NOISE_URL = re.compile(r"(?:https?://)?mp\.weixin\.qq\.com/\S*")

# PDF 导出的「CJK Radicals Supplement」字形（⻆⻓⻔⻛）没有 NFKC 兼容映射，
# 只能按字表还原成正常汉字，否则页面和搜索都会拿到生僻字形。
RADICAL_MAP = {
    "\u2ec5": "见",
    "\u2ec6": "角",
    "\u2ed3": "长",
    "\u2ed4": "门",
    "\u2edb": "风",
    "\u2edc": "飞",
}

# 公众号推广语、正文字数统计等非学习内容。
PROMO = re.compile(
    r"关注微信公众号\s*【[^】]{0,20}】[^。\n]{0,90}。?"
    r"|加入训练营[^。\n]{0,90}。?"
    r"|按照群公告[^。\n]{0,90}。?"
    r"|在\s*\[?资料禁言群\]?\s*中查看全文翻译[^。\n]{0,90}。?"
    r"|推荐在线打印[^。\n]{0,60}。?"
    r"|微信扫码[^。\n]{0,60}。?"
    r"|正文字数\s*[:：]?\s*\d+\s*[Ww]ords"
)

# 段落被 PDF 切分时，译文偶尔以半个右括号/顿号开头。
LEADING_PUNCT = re.compile(r"^[）)】」』、,，;；:：]{1,3}\s*")

# 解析里整条都是训练营招生话术的段落，直接丢弃（不含任何题解标记）。
AD_BLOCK = re.compile(r"^训练营创办\d+年来[^【]{0,220}$")

# 页脚「7 September 2026 | The Guardian」被当成正文段落，整段丢弃。
FOOTER_BLOCK = re.compile(r"^\d{1,2}\s+[A-Za-z]+\s+\d{4}\s*[|｜]")

# 精读页的生词栏被 PDF 合并进译文时，会出现「中文释义 + 无空格英文例句 + 例句中译」
# 这样的粘连前缀。英文例句在文本层里丢掉了空格，因此只能按连续拉丁字母长度识别。
GLUED_EXAMPLE = re.compile(r"[A-Za-z][A-Za-z0-9'’,;:\-]{19,}[.!?]?")
SHORT_GLOSS = re.compile(r"\s*[^。！？]{1,24}[。！？]")


def strip_glued_example(value: str) -> str:
    """Drop a leading vocabulary card that got merged into a translation."""
    match = GLUED_EXAMPLE.search(value)
    if not match:
        return value
    head = value[: match.start()]
    tail = value[match.end() :]
    if not head.strip() or len(head.strip()) > 30 or "。" in head:
        return value
    if not re.search(r"[\u4e00-\u9fff]", head) or not re.search(r"[\u4e00-\u9fff]", tail):
        return value
    gloss = SHORT_GLOSS.match(tail)
    if gloss:
        tail = tail[gloss.end() :]
    return tail.lstrip()


def fold_char(char: str) -> str:
    """Fold compatibility glyphs that are safe to rewrite, punctuation aside."""
    if char in RADICAL_MAP:
        return RADICAL_MAP[char]
    code = ord(char)
    if (
        0x2E80 <= code <= 0x2FDF  # CJK 部首 / 康熙部首
        or 0xFB00 <= code <= 0xFB06  # 拉丁连字 ﬁ ﬂ
        or 0xFF10 <= code <= 0xFF19  # 全角数字
        or 0xFF21 <= code <= 0xFF3A  # 全角大写
        or 0xFF41 <= code <= 0xFF5A  # 全角小写
    ):
        return unicodedata.normalize("NFKC", char)
    return char


def clean_text(value: str, path: str = "") -> str:
    if AD_BLOCK.match(value.strip()):
        return ""
    text = "".join(fold_char(char) for char in value)
    text = NOISE_URL.sub(" ", text)
    text = WATERMARK.sub("", text)
    text = PROMO.sub(" ", text)
    if path.endswith(".zh") or path.endswith(".text"):
        text = LEADING_PUNCT.sub("", text.lstrip())
    text = strip_glued_example(text)
    text = text.replace("\u200b", "").replace("\ufeff", "")
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def walk(node, stats: dict, path: str = "") -> object:
    if isinstance(node, str):
        fixed = clean_text(node, path)
        if fixed != node:
            stats["fields"] += 1
            stats["paths"].add(path)
        return fixed
    if isinstance(node, list):
        return [walk(item, stats, path) for item in node]
    if isinstance(node, dict):
        if {"en", "zh"} <= set(node) and isinstance(node.get("en"), str):
            if FOOTER_BLOCK.match(node["en"].strip()) and len(node["en"]) < 80:
                if node["en"] or node.get("zh"):
                    stats["fields"] += 1
                    stats["paths"].add(path + ".footer")
                return {**node, "en": "", "zh": ""}
        return {key: walk(value, stats, f"{path}.{key}") for key, value in node.items()}
    return node


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default=".cache/periodical-raw2")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    raw_dir = pathlib.Path(args.raw).resolve()
    if not raw_dir.exists():
        print(f"[缺失] {raw_dir}")
        return 1

    changed_files = 0
    total_fields = 0
    path_counter: dict[str, int] = {}
    leftovers: dict[str, int] = {}
    for path in sorted(raw_dir.glob("*.json")):
        if path.name == "manifest.json":
            continue
        entry = json.loads(path.read_text(encoding="utf-8"))
        stats: dict = {"fields": 0, "paths": set()}
        fixed = walk(entry, stats)
        if stats["fields"]:
            changed_files += 1
            total_fields += stats["fields"]
            for name in stats["paths"]:
                path_counter[name] = path_counter.get(name, 0) + 1
            if args.write:
                path.write_text(
                    json.dumps(fixed, ensure_ascii=False, indent=2), encoding="utf-8"
                )
        for char in json.dumps(fixed, ensure_ascii=False):
            if 0x2E80 <= ord(char) <= 0x2FDF:
                leftovers[char] = leftovers.get(char, 0) + 1

    mode = "写入" if args.write else "预演"
    print(f"合计：{mode} 命中 {changed_files} 个文件 / {total_fields} 个字段")
    for name, count in sorted(path_counter.items(), key=lambda item: -item[1])[:12]:
        print(f"  - {name}: {count}")
    if leftovers:
        print("剩余 CJK 部首字形（需要补 RADICAL_MAP）：")
        for char, count in leftovers.items():
            print(f"  - U+{ord(char):04X} {char} x{count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
