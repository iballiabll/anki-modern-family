"""用 pdfminer 的坐标信息回填外刊精读的逐段中文译文。

背景：scripts/extract-periodical.py 基于 pdfplumber 取字，部分 PDF 的嵌入字
体缺少可用的 ToUnicode 映射，中文行会被整段丢掉；pdfminer.six 对同一批文件
能正确还原中文。这里不重跑整套解析，只针对「中文为空」的段落做增量修复：

    python scripts/fix-periodical-translations.py --dry-run
    python scripts/fix-periodical-translations.py --write

版式规律（已在 9.24 / 9.19 / 9.4 / 8.25 / 8.29 等精读 PDF 上核对）：
- 正文由 `【Para.N】` 标记分成块，块内顺序为「英文正文 -> 生词注释 -> 中文译文」；
- 译文首行带首行缩进，x0 约 118~120；生词与例句续行 x0 约 111~112，
  句子分析 / 写作积累板块的说明行多为 x0 = 90；
- 页码、`版权所有，禁止传播` 页脚、`公众号：经济学人考研英语` 水印会插在
  译文中间或页尾，需要跳过而不是当成断点；
- 译文经常跨页，收集时必须跨页拼接。

只写入 zh 为空的段落，不覆盖已有译文与生词。写入前对候选文本做自动审计，
命中「噪音 / 学习板块 / 生词行 / 长度比例异常」的段落放弃回填并打印告警。
"""

from __future__ import annotations

import argparse
import json
import logging
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pdfminer").setLevel(logging.ERROR)
logging.getLogger("pdfminer.pdfinterp").setLevel(logging.ERROR)

from pdfminer.high_level import extract_pages  # noqa: E402
from pdfminer.layout import LTTextContainer, LTTextLine  # noqa: E402

CJK_RE = re.compile(r"[\u3400-\u9fff]")
PARA_RE = re.compile(r"[【\[]\s*\ufe0f?\s*[Pp]ara\.?\s*(\d{1,2})\s*[】\]]")
WATERMARK_RE = re.compile(r"公众号[:：]?\s*经济学人考研英语")
NOISE_RE = re.compile(r"版权所有|禁止传播|公众号[:：]?\s*经济学人考研英语")
PAGE_NUMBER_RE = re.compile(r"^[\s0-9]+$")
BULLET_CHARS = "\uf077\u3063\uf06c\u25cf\u25cb\u30fb\u2022\u25aa"
BULLET_RE = re.compile(r"^[\s" + BULLET_CHARS + r"]+")
STUDY_RE = re.compile(
    r"^\s*[➢" + BULLET_CHARS + r"]*\s*(?:写作积累|今日翻译作业|今日句子分析|句子分析[:：]|"
    r"微信扫码加入我们|推荐在线打印渠道|正文字数|"
    r"关注微信公众号|加入训练营|资料禁言群|按照群公告)"
)
GRAMMAR_RE = re.compile(
    r"定语从句|状语从句|宾语从句|主语从句|表语从句|名词性从句|"
    r"非限定性定语|后置定语|表语补足语|补足语|同位语|插入语|"
    r"非谓语|独立主格|虚拟语气|倒装|强调句|省略|固定搭配|"
    r"时间状语|比较状语|地点状语|方式状语|目的状语|结果状语|"
    r"让步状语|条件状语|范围状语|方面状语"
)
# 生词条目的形态标记：音标斜杠、词性缩写、SYN/OPP 同反义、考纲标签。
# 音标要求斜杠前不是字母数字，避免把译文里的 “1/10”“1/20” 误判成音标。
VOCAB_RE = re.compile(
    r"(?<![A-Za-z0-9])/[^\s/][^/\n]{0,40}/|【\s*考研大纲词汇\s*】|"
    r"(?<![A-Za-z])(?:SYN|OPP)[:：\s]|"
    r"(?:^|\s)(?:n|v|vt|vi|adj|adv|prep|conj|pron|phr|abbr)\.\s"
)
SYN_OPP_RE = re.compile(r"(?<![A-Za-z])(?:SYN|OPP)[:：\s]|【\s*考研大纲词汇\s*】")
TRANSLATION_INDENT = 116.0


def line_text(line: LTTextLine) -> str:
    """取整行文本。

    注意不能只拼 LTChar：PDF 里的空格由 LTAnno 承载，只取 LTChar 会得到
    “AItechnologythatlistensto...” 这种无空格英文。get_text() 保留空格。
    """

    return line.get_text().replace("\n", "").strip()


def cjk_count(text: str) -> int:
    return len(CJK_RE.findall(text))


def letter_count(text: str) -> int:
    return len([char for char in text if char.isascii() and char.isalpha()])


def word_count(text: str) -> int:
    return len([part for part in re.split(r"[^A-Za-z]+", text) if part])


def read_lines(pdf_path: pathlib.Path) -> list[dict]:
    """按页读取文本行，附带页码与坐标，跨页连续编号。"""

    rows: list[dict] = []
    for page_index, page in enumerate(extract_pages(str(pdf_path))):
        pending: list[LTTextLine] = []

        def walk(obj) -> None:
            if isinstance(obj, LTTextContainer):
                for child in obj:
                    if isinstance(child, LTTextLine):
                        pending.append(child)
            if hasattr(obj, "__iter__"):
                for child in obj:
                    walk(child)

        walk(page)
        for line in pending:
            text = line_text(line)
            if not text:
                continue
            rows.append(
                {
                    "page": page_index,
                    "y0": float(line.y0),
                    "x0": float(line.x0),
                    "text": text,
                }
            )
    rows.sort(key=lambda row: (row["page"], -row["y0"], row["x0"]))
    return rows


def is_noise(row: dict) -> bool:
    text = row["text"]
    if NOISE_RE.search(text):
        return True
    # 页码只出现在页脚附近的纯数字行。
    if PAGE_NUMBER_RE.match(text) and row["y0"] < 100:
        return True
    return False


def looks_english_dominant(text: str) -> bool:
    cjk = cjk_count(text)
    letters = letter_count(text)
    return letters >= 8 and letters > cjk * 2


def breaks_translation(text: str) -> bool:
    """译文续行的硬断点。

    译文里出现英文人名/机构名（如 “廉（William the Conqueror）” ）时，
    英文占比会高于中文，不能据此断行；真正要断的是整行英文、同反义词标签
    和考纲标签这类生词条目内容。
    """

    cjk = cjk_count(text)
    if cjk == 0:
        return True
    if SYN_OPP_RE.search(text):
        return True
    return letter_count(text) > cjk * 3


def cjk_count_of(body: list[dict]) -> int:
    return sum(cjk_count(row["text"]) for row in body)


def split_blocks(rows: list[dict]) -> dict[int, list[dict]]:
    """按 `【Para.N】` 切块；同一编号重复出现时保留中文更多的那个块。"""

    blocks: dict[int, list[dict]] = {}
    number: int | None = None
    body: list[dict] = []

    def flush() -> None:
        if number is None:
            return
        previous = blocks.get(number)
        if previous is None or cjk_count_of(previous) < cjk_count_of(body):
            blocks[number] = list(body)

    for row in rows:
        match = PARA_RE.search(row["text"])
        if match:
            flush()
            number = int(match.group(1))
            body = []
            continue
        if number is not None:
            body.append(row)
    flush()
    return blocks


def cut_study(body: list[dict]) -> list[dict]:
    for index, row in enumerate(body):
        if STUDY_RE.search(row["text"]):
            return body[:index]
    return body


def collect_runs(body: list[dict]) -> list[list[dict]]:
    """收集所有可能的译文连续段：首行必须有缩进，之后按行延伸并跳过页脚。"""

    runs: list[list[dict]] = []
    current: list[dict] = []
    for row in body:
        text = row["text"]
        if is_noise(row):
            if current:
                current.append(row)
            continue
        if BULLET_RE.match(text):
            if current:
                runs.append(current)
                current = []
            continue
        if current:
            if breaks_translation(text):
                runs.append(current)
                current = []
                continue
            current.append(row)
            continue
        if (
            cjk_count(text) >= 2
            and not looks_english_dominant(text)
            and row["x0"] >= TRANSLATION_INDENT
        ):
            current = [row]
    if current:
        runs.append(current)
    return runs


def clean_text(run: list[dict]) -> str:
    text = "".join(row["text"] for row in run if not is_noise(row))
    text = WATERMARK_RE.sub("", text)
    text = text.replace("版权所有，禁止传播", "").replace("版权所有 禁止传播", "")
    text = re.sub(r"\s+", "", text)
    return text


def raw_text(run: list[dict]) -> str:
    """保留空格的行文本，用于识别生词条目形态（音标、SYN/OPP、词性缩写）。"""

    text = " ".join(row["text"] for row in run if not is_noise(row))
    return re.sub(r"\s+", " ", text).strip()


def is_vocab_head(row: dict) -> bool:
    return bool(BULLET_RE.match(row["text"])) or (
        bool(VOCAB_RE.search(row["text"])) and row["x0"] < 100
    )


def choose_run(body: list[dict]) -> tuple[dict | None, list[list[dict]]]:
    """取块内最后一条生词之后、最长的中文连续段。"""

    body = cut_study(body)
    last_bullet = -1
    for index, row in enumerate(body):
        if is_vocab_head(row):
            last_bullet = index
    runs = collect_runs(body)
    if not runs:
        return None, []
    scored: list[tuple[int, int, int, list[dict]]] = []
    for run in runs:
        start = body.index(run[0])
        text = clean_text(run)
        cjk = cjk_count(text)
        if cjk < 8:
            continue
        if GRAMMAR_RE.search(text) and cjk < 40:
            continue
        after_bullet = 1 if start > last_bullet else 0
        scored.append((after_bullet, cjk, start, run))
    if not scored:
        return None, runs
    scored.sort(key=lambda item: (item[0], item[1], item[2]))
    best = scored[-1][3]
    first = next((row for row in best if not is_noise(row)), best[0])
    return {
        "run": best,
        "text": clean_text(best),
        "raw": raw_text(best),
        "first": first,
    }, runs


def audit(
    text: str,
    raw: str,
    english: str,
    run_count: int,
    ratios: tuple[float, float],
) -> list[str]:
    flags: list[str] = []
    if NOISE_RE.search(text):
        flags.append("noise")
    if STUDY_RE.search(text):
        flags.append("study")
    if re.search(r"写作积累|今日翻译作业|今日句子分析|正文字数", text):
        flags.append("section-text")
    # 译文里允许出现英文人名/缩写，但生词条目的形态标记不该出现。
    if VOCAB_RE.search(raw):
        flags.append("vocab-like")
    cjk = cjk_count(text)
    words = word_count(english)
    if words:
        ratio = cjk / words
        if ratio < ratios[0]:
            flags.append(f"short:{ratio:.2f}")
        elif ratio > ratios[1]:
            flags.append(f"long:{ratio:.2f}")
    if cjk < 8:
        flags.append("tiny")
    if run_count > 3:
        flags.append(f"runs={run_count}")
    return flags


def translation_ratio_baseline(raw_dir: pathlib.Path) -> tuple[float, float]:
    """用现有译文标定「中文字数 / 英文词数」的正常区间。"""

    ratios: list[float] = []
    for raw_path in sorted(raw_dir.glob("*.json")):
        data = json.loads(raw_path.read_text(encoding="utf-8"))
        if data.get("kind") != "reading":
            continue
        for item in ((data.get("reading") or {}).get("paragraphs")) or []:
            zh = (item.get("zh") or "").strip()
            en = (item.get("en") or "").strip()
            if not zh or not en:
                continue
            words = word_count(en)
            if words >= 12:
                ratios.append(cjk_count(zh) / words)
    if len(ratios) < 20:
        return 0.85, 3.6
    ratios.sort()
    low = ratios[int(len(ratios) * 0.05)]
    high = ratios[int(len(ratios) * 0.95)]
    return max(0.6, low * 0.9), min(4.5, high * 1.1)


def repair_file(
    raw_path: pathlib.Path,
    root: pathlib.Path,
    write: bool,
    ratios: tuple[float, float],
) -> dict:
    data = json.loads(raw_path.read_text(encoding="utf-8"))
    if data.get("kind") != "reading":
        return {"status": "skip"}
    source = root / data.get("file", "")
    if source.suffix.lower() != ".pdf" or not source.exists():
        return {"status": "skip"}

    paragraphs = ((data.get("reading") or {}).get("paragraphs")) or []
    missing = [item for item in paragraphs if not (item.get("zh") or "").strip()]
    if not missing:
        return {"status": "clean"}

    blocks = split_blocks(read_lines(source))
    filled = 0
    unresolved: list[tuple[int, str]] = []
    warnings: list[tuple[int, list[str], str]] = []

    for item in missing:
        index = item.get("index")
        body = blocks.get(index, [])
        if not body:
            unresolved.append((index, "no-block"))
            continue
        choice, runs = choose_run(body)
        if not choice:
            unresolved.append((index, "no-run"))
            continue
        text = choice["text"]
        english = (item.get("en") or "").strip()
        flags = audit(text, choice["raw"], english, len(runs), ratios)
        if flags:
            warnings.append((index, flags, text))
            continue
        if write:
            item["zh"] = text
        filled += 1

    if write and filled:
        raw_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    return {
        "status": "filled" if filled else "unresolved",
        "file": source.name,
        "filled": filled,
        "missing": len(missing),
        "unresolved": unresolved,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=r"D:\外刊")
    parser.add_argument("--raw", default=".cache/periodical-raw2")
    parser.add_argument("--write", action="store_true", help="真正写回原始 JSON")
    args = parser.parse_args()
    write = bool(args.write)

    root = pathlib.Path(args.root)
    raw_dir = pathlib.Path(args.raw)
    ratios = translation_ratio_baseline(raw_dir)
    print(f"中文/英文长度基线：{ratios[0]:.2f} ~ {ratios[1]:.2f}", flush=True)

    total_filled = 0
    total_missing = 0
    total_warn = 0
    total_unresolved = 0
    for raw_path in sorted(raw_dir.glob("*.json")):
        result = repair_file(raw_path, root, write, ratios)
        if result["status"] not in {"filled", "unresolved"}:
            continue
        total_filled += result["filled"]
        total_missing += result["missing"]
        total_warn += len(result["warnings"])
        total_unresolved += len(result["unresolved"])
        note = ""
        if result["unresolved"]:
            note += " 未定位=" + ",".join(
                f"Para.{index}({reason})" for index, reason in result["unresolved"]
            )
        if result["warnings"]:
            note += " 告警=" + ",".join(
                f"Para.{index}[{','.join(flags)}]" for index, flags, _ in result["warnings"]
            )
        print(
            f"{'写入' if write else '预演'} {result['file']}: "
            f"{result['filled']}/{result['missing']}{note}",
            flush=True,
        )
        for index, flags, text in result["warnings"]:
            print(f"    Para.{index} {','.join(flags)} :: {text[:160]}", flush=True)

    print(
        f"合计：{'已写入' if write else '可回填'} {total_filled} 段 / 原缺失 {total_missing} 段，"
        f"告警 {total_warn} 段，未定位 {total_unresolved} 段",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
