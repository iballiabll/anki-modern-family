"""从 PDF 重解析外刊精读的段落与生词，修复 pdfplumber 切分错位的历史数据。

背景：scripts/extract-periodical.py 用 pdfplumber 的版面顺序切块，其中 11 期
（8.17 / 8.24 / 8.27 / 8.31 / 9.2 / 9.7 / 9.9 / 9.10 / 9.17 / 9.21 / 9.22）
的英文正文、生词注释、中文译文被串到了一起：`en` 里混进 SYN/生词释义，
`zh` 里混进英文例句，`vocab` 大面积丢失。这批文件不能靠补译文解决，必须按
`Para.N` 标记重新切块。

版式规律（已在上述 11 期上逐一核对）：
- 段落头有两种写法：`【Para.1】`（8.24 起）与 `• Para. 1`（8.17）；
- 块内顺序固定为「英文正文 -> 生词条目 -> 中文译文」；
- 生词条目以 Wingdings bullet 起行，条目内续行 x0≈111，例句行 x0≈105~111；
- 译文首行有首行缩进（x0≈118~120），8.17 那期例外，译文与正文同为 x0≈90，
  因此找不到缩进译文时退化为「按 CJK 连续段取最长」；
- `句子分析` / `主句` / `写作积累` 等模块不属于段落内容，先截断再取译文；
- 8.17 的 PDF 里撇号被映射成 NUL（`China\\x00s`），需要还原为 `China’s`。

用法：
    python scripts/rebuild-periodical-readings.py --dry-run
    python scripts/rebuild-periodical-readings.py --write

写入前对每期打印英文正文/译文与生词条数的审计摘要，任何异常都以告警列出。

注意：本脚本只负责重新切分段落，写回后必须接着跑
``python scripts/normalize-periodical-text.py --write`` 清理页脚水印、生词卡片
粘连和生僻字形，然后再执行 ``npm run build:periodical``。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import logging
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pdfminer").setLevel(logging.ERROR)


def load_helper():
    """复用译文修复脚本里的行读取与噪音判定，避免两套实现漂移。"""

    path = pathlib.Path(__file__).with_name("fix-periodical-translations.py")
    spec = importlib.util.spec_from_file_location("fix_periodical_translations", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HELPER = load_helper()
CJK_RE = HELPER.CJK_RE
NOISE_RE = HELPER.NOISE_RE
WATERMARK_RE = HELPER.WATERMARK_RE
BULLET_CHARS = HELPER.BULLET_CHARS + "\uf0d8\uf0a7\uf0e0"

# 段落头：整行只有标记本身。`Para.1-2` 这类脉络区间不会被匹配。
HEADER_RE = re.compile(
    r"^[\s"
    + BULLET_CHARS
    + r"]*(?:【|\[)?\s*[Pp]ara\.?\s*(\d{1,2})\s*(?:】|\])?[\s"
    + BULLET_CHARS
    + r"]*$"
)
# 生词条目起行：bullet + 词条。
ENTRY_RE = re.compile(r"^[\s" + BULLET_CHARS + r"]+\S")
# 段落内容之外的模块，出现即截断。
STOP_RE = re.compile(
    r"^\s*[➢"
    + BULLET_CHARS
    + r"]*\s*(?:句子分析|主句|句子主干|学习流程|写作积累|今日翻译作业|"
    r"今日句子分析|今日文章脉络|背景补充阅读|微信扫码|推荐在线打印|"
    r"正文字数|关注微信公众号|加入训练营|资料禁言群|按照群公告|"
    r"文章脉络|翻译作业|语法|长难句)"
)
TAG_RE = re.compile(r"【\s*[^】]{0,20}\s*】")
POS_RE = re.compile(
    r"^(?P<term>.+?)\s+"
    r"(?P<pos>phrase|phr|n|v|vt|vi|a|adj|adv|ad|prep|conj|pron|abbr|num|int)\.?\s*"
    r"(?P<rest>.*)$"
)
PHONETIC_RE = re.compile(r"/([^/\n]{1,40})/")
SYN_OPP_RE = re.compile(r"^(?:SYN|OPP)[:：\s]", re.IGNORECASE)

# 交接表里登记的受损期次（raw 目录里的文件名）。
DAMAGED = [
    "014",
    "029",
    "035",
    "041",
    "045",
    "059",
    "066",
    "072",
    "073",
    "083",
    "089",
]


def fix_nul(text: str) -> str:
    """还原被错误映射成 NUL 的撇号，并清掉其余 NUL。"""

    if not text:
        return text
    text = re.sub(r"(?<=[A-Za-z])[ \t]*\x00[ \t]*(?=[A-Za-z])", "\u2019", text)
    return text.replace("\x00", "")


def cjk_count(text: str) -> int:
    return len(CJK_RE.findall(text))


def letter_count(text: str) -> int:
    return len([char for char in text if char.isascii() and char.isalpha()])


def is_noise(row: dict) -> bool:
    return HELPER.is_noise(row)


def strip_bullet(text: str) -> str:
    return re.sub(r"^[\s" + BULLET_CHARS + r"]+", "", text).strip()


def join_lines(rows: list[dict]) -> str:
    """按阅读顺序拼接行文本，行尾连字符不断词。"""

    parts: list[str] = []
    for row in rows:
        text = row["text"].strip()
        if not text:
            continue
        if parts and parts[-1].endswith("-"):
            parts[-1] = parts[-1][:-1] + text
        else:
            parts.append(text)
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def split_blocks(rows: list[dict]) -> list[tuple[int, list[dict]]]:
    """按段落头切块，保持出现顺序。"""

    blocks: list[tuple[int, list[dict]]] = []
    number: int | None = None
    body: list[dict] = []
    for row in rows:
        match = HEADER_RE.match(row["text"])
        if match:
            if number is not None:
                blocks.append((number, body))
            number = int(match.group(1))
            body = []
            continue
        if number is not None:
            body.append(row)
    if number is not None:
        blocks.append((number, body))
    return blocks


def cut_body(body: list[dict]) -> list[dict]:
    for index, row in enumerate(body):
        if STOP_RE.match(row["text"]):
            return body[:index]
    return body


def body_score(body: list[dict]) -> int:
    """块内容量：英文正文与译文字符数之和，用于同一段号出现多次时择优。"""

    return sum(letter_count(row["text"]) + cjk_count(row["text"]) for row in body)


def dedupe_blocks(blocks: list[tuple[int, list[dict]]]) -> list[tuple[int, list[dict]]]:
    """8.17 的「今日文章脉络」示意图里也会单独成行出现 `Para.11` 这类标记，
    会切出没有正文的空块；9.21 等期的「句子分析」页还会把同一段号再抄一遍。

    择优规则：先看块里有没有生词条目（真正文必有 bullet 生词），再看内容量。
    只按内容量排会让抄了正文并附带语法讲解的分析页胜出。
    """

    best: dict[int, tuple[int, list[dict]]] = {}
    order: list[int] = []

    def rank(body: list[dict]) -> tuple[int, int]:
        cut = cut_body(body)
        has_entry = 1 if any(ENTRY_RE.match(row["text"]) for row in cut) else 0
        return has_entry, body_score(cut)

    for number, body in blocks:
        if number not in best:
            best[number] = (number, body)
            order.append(number)
            continue
        if rank(body) > rank(best[number][1]):
            best[number] = (number, body)
    return [best[number] for number in order]


def english_body(body: list[dict]) -> tuple[list[dict], str]:
    """英文正文：段落头之后、第一个生词条目之前的最长英文连续段。"""

    head = len(body)
    for index, row in enumerate(body):
        if ENTRY_RE.match(row["text"]):
            head = index
            break
    best: list[dict] = []
    current: list[dict] = []
    for row in body[:head]:
        text = row["text"]
        if is_noise(row):
            if current:
                current.append(row)
            continue
        if cjk_count(text) == 0 and letter_count(text) >= 8:
            current.append(row)
        else:
            if len(current) > len(best):
                best = current
            current = []
    if len(current) > len(best):
        best = current
    return best, join_lines([row for row in best if not is_noise(row)])


def translation_run(body: list[dict]) -> tuple[list[dict], str, list[str]]:
    """译文：最后一个生词条目之后、最长的中文连续段。

    首行缩进是本系列多数期次的规律，但 8.17 用 x0≈90、9.10 用 x0≈105，
    单靠阈值会漏；因此缩进段与宽松段一起评分，同分时优先缩进段，
    并在选到宽松段时打出 `no-indent-fallback` 供人工复核。
    """

    body = cut_body(body)
    last_entry = -1
    for index, row in enumerate(body):
        if ENTRY_RE.match(row["text"]):
            last_entry = index
    tail = body[last_entry + 1 :] if last_entry >= 0 else body

    def collect(indent_only: bool) -> list[list[dict]]:
        runs: list[list[dict]] = []
        current: list[dict] = []
        for row in tail:
            text = row["text"]
            if is_noise(row):
                if current:
                    current.append(row)
                continue
            if ENTRY_RE.match(text) or SYN_OPP_RE.match(text):
                if current:
                    runs.append(current)
                    current = []
                continue
            if current:
                if cjk_count(text) >= 1:
                    current.append(row)
                else:
                    runs.append(current)
                    current = []
                continue
            cjk = cjk_count(text)
            if cjk < 6:
                continue
            if not indent_only or row["x0"] >= HELPER.TRANSLATION_INDENT:
                current = [row]
        if current:
            runs.append(current)
        return runs

    def score(run: list[dict]) -> int:
        return sum(cjk_count(row["text"]) for row in run)

    notes: list[str] = []
    indent_runs = collect(indent_only=True)
    relaxed_runs = collect(indent_only=False)
    indent_best = max(indent_runs, key=score) if indent_runs else None
    relaxed_best = max(relaxed_runs, key=score) if relaxed_runs else None
    if indent_best is None and relaxed_best is None:
        return [], "", ["no-translation"]
    # 宽松段会把最后一个生词条目的例句译文并进来，因此只在缩进段明显偏短
    # （不足宽松段的 30%）或根本不存在时采用，并留下复核标记。
    if indent_best is not None and (
        relaxed_best is None or score(indent_best) >= 0.3 * score(relaxed_best)
    ):
        best = indent_best
    elif relaxed_best is not None:
        best = relaxed_best
        notes.append("no-indent-fallback")
        # 回退段可能把最后一条生词的例句译文并进来，去掉起首的英文短行。
        best = trim_leading_example(best)
    else:
        best = indent_best
    if len(best) <= 1:
        notes.append("single-line")
    text = "".join(row["text"] for row in best if not is_noise(row))
    text = WATERMARK_RE.sub("", text)
    text = text.replace("版权所有，禁止传播", "").replace("版权所有 禁止传播", "")
    text = re.sub(r"\s+", "", text)
    return best, text, notes


def trim_leading_example(run: list[dict]) -> list[dict]:
    """去掉回退段起首的「英文例句 + 中文释义」行。

    这类行以英文字母起首（`sources of energy. 可再生能源……`），而段落译文
    首行要么是中文，要么是数字/引号，所以按起首字符判断即可。
    """

    trimmed = list(run)
    while trimmed:
        text = trimmed[0]["text"].strip()
        if re.match(r"^[A-Za-z\"'“]", text):
            trimmed.pop(0)
            continue
        break
    return trimmed


def parse_vocab(body: list[dict]) -> tuple[list[dict], list[str]]:
    """把生词条目解析成站点用的字段。"""

    body = cut_body(body)
    starts = [index for index, row in enumerate(body) if ENTRY_RE.match(row["text"])]
    if not starts:
        return [], []
    entries: list[dict] = []
    skipped: list[str] = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(body)
        rows = [
            row
            for row in body[start:end]
            if not is_noise(row) and not STOP_RE.match(row["text"])
        ]
        # 截掉尾随的译文行：首个缩进中文行之后都不属于生词条目。
        cleaned: list[dict] = []
        for row in rows:
            if (
                cjk_count(row["text"]) >= 6
                and row["x0"] >= HELPER.TRANSLATION_INDENT
                and not PHONETIC_RE.search(row["text"])
            ):
                break
            cleaned.append(row)
        if not cleaned:
            continue
        head_text = strip_bullet(cleaned[0]["text"])
        # 音标可能被排版断成两行（`broker /ˈbr` + `əʊkə(r)/ A person who…`），
        # 先把斜杠没闭合的续行并回首行再解析。
        merged = 1
        while head_text.count("/") % 2 == 1 and merged < len(cleaned):
            head_text += " " + cleaned[merged]["text"].strip()
            merged += 1
        match = POS_RE.match(head_text)
        if not match:
            # 少数条目只给音标不给词性（`broker /ˈbrəʊkə(r)/ A person who...`）。
            fallback = re.match(
                r"^(?P<term>[A-Za-z][A-Za-z’'\-]*(?:\s+[A-Za-z][A-Za-z’'\-]*){0,2})"
                r"\s+(?P<rest>(?:/[^/\n]{1,40}/?|【).*)$",
                head_text,
            )
            if not fallback:
                skipped.append(head_text[:24])
                continue
            term = re.sub(r"\s+", " ", fallback.group("term")).strip()
            pos = ""
            rest = fallback.group("rest")
        else:
            term = re.sub(r"\s+", " ", match.group("term")).strip()
            pos = match.group("pos")
            rest = match.group("rest")
        phonetic = ""
        phonetic_match = PHONETIC_RE.search(rest)
        if phonetic_match:
            phonetic = phonetic_match.group(1).strip()
            rest = (rest[: phonetic_match.start()] + " " + rest[phonetic_match.end() :]).strip()
        tags = [tag.strip("【】 ") for tag in TAG_RE.findall(head_text + " " + " ".join(r["text"] for r in cleaned[1:]))]
        rest = TAG_RE.sub(" ", rest).strip()

        definition_parts: list[str] = []
        gloss_parts: list[str] = []
        example_parts: list[str] = []
        example_zh_parts: list[str] = []
        in_example = False

        def absorb(text: str, target_en: list[str], target_zh: list[str]) -> None:
            text = TAG_RE.sub(" ", text).strip()
            if not text:
                return
            first_cjk = next(
                (index for index, char in enumerate(text) if CJK_RE.match(char)), None
            )
            if first_cjk is None:
                target_en.append(text)
                return
            head_en = text[:first_cjk].strip()
            head_zh = text[first_cjk:].strip()
            if head_en:
                target_en.append(head_en)
            if head_zh:
                target_zh.append(head_zh)

        absorb(rest, definition_parts, gloss_parts)
        for row in cleaned[merged:]:
            text = row["text"].strip()
            if not text:
                continue
            if not in_example:
                if SYN_OPP_RE.match(text):
                    definition_parts.append(text)
                    continue
                # 例句行有两种版式：纯英文行（译文在下一行）与「英文 + 译文」同行。
                # 释义已经出现过句点时，再遇到大写/引号起首的行即视为例句。
                definition_so_far = " ".join(definition_parts)
                if re.match(r"^[A-Z\"“0-9]", text) and "." in definition_so_far:
                    in_example = True
                    absorb(text, example_parts, example_zh_parts)
                    continue
                absorb(text, definition_parts, gloss_parts)
                continue
            absorb(text, example_parts, example_zh_parts)

        entries.append(
            {
                "term": term,
                "head": (f"{pos}. " if pos else "") + " ".join(definition_parts).strip(),
                "pos": pos,
                "phonetic": phonetic,
                "definition": " ".join(definition_parts).strip(),
                "gloss": "".join(gloss_parts).strip(),
                "example": " ".join(example_parts).strip(),
                "exampleZh": "".join(example_zh_parts).strip(),
                "tags": tags,
            }
        )
    return entries, skipped


def process(entry: dict, pdf_path: pathlib.Path, verbose: bool) -> list[str]:
    warnings: list[str] = []
    rows = HELPER.read_lines(pdf_path)
    for row in rows:
        row["text"] = fix_nul(row["text"])
    blocks = dedupe_blocks(split_blocks(rows))
    if not blocks:
        return ["no-para-blocks"]

    paragraphs: list[dict] = []
    vocab: list[dict] = []
    for number, body in blocks:
        _, english = english_body(body)
        run, chinese, notes = translation_run(body)
        items, skipped = parse_vocab(body)
        vocab.extend(items)
        if skipped:
            warnings.append(f"para-{number}-vocab-skipped:{len(skipped)}")
        if not english:
            warnings.append(f"para-{number}-no-english")
        if not chinese:
            warnings.append(f"para-{number}-no-translation")
        if len(chinese) > 0 and english:
            ratio = len(chinese) / max(1, letter_count(english))
            if ratio < 0.25 or ratio > 3.5:
                warnings.append(f"para-{number}-ratio-{ratio:.2f}")
        warnings.extend(f"para-{number}-{note}" for note in notes)
        paragraphs.append({"index": number, "en": english, "zh": chinese})
        if verbose:
            print(
                f"    Para.{number}: en={letter_count(english)}字 zh={len(chinese)}字 "
                f"vocab={len(items)} runs={1 if run else 0}"
            )

    reading = entry.setdefault("reading", {})
    reading["paragraphs"] = sorted(paragraphs, key=lambda item: item["index"])
    reading["vocab"] = vocab
    for key in ("title", "titleZh"):
        if isinstance(reading.get(key), str):
            reading[key] = fix_nul(reading[key])
    headline = entry.get("headline")
    if isinstance(headline, dict):
        for key, value in list(headline.items()):
            if isinstance(value, str):
                headline[key] = fix_nul(value)
    return warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default=".cache/periodical-raw2")
    parser.add_argument("--root", default="D:/外刊")
    parser.add_argument("--only", nargs="*", default=None)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    raw_dir = pathlib.Path(args.raw).resolve()
    root_dir = pathlib.Path(args.root)
    targets = args.only or DAMAGED
    total_warnings = 0
    processed = 0

    for name in targets:
        path = raw_dir / f"{name}.json"
        if not path.exists():
            print(f"[缺失] {path}")
            continue
        entry = json.loads(path.read_text(encoding="utf-8"))
        source = pathlib.Path(entry.get("sourcePath") or entry.get("file") or "")
        pdf_path = source if source.is_absolute() and source.exists() else root_dir / source.name
        if not pdf_path.exists():
            print(f"[跳过] {name}: 找不到 PDF {pdf_path}")
            continue
        print(f"[处理] {name} <- {pdf_path.name}")
        warnings = process(entry, pdf_path, verbose=not args.quiet)
        total_warnings += len(warnings)
        processed += 1
        if warnings:
            print("   告警: " + "; ".join(warnings))
        if args.write:
            path.write_text(
                json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print("   已写入")

    mode = "写入" if args.write else "预演"
    print(f"合计：{mode} {processed} 期，告警 {total_warnings} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
