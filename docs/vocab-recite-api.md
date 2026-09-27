# 背词记录接口（window.IballVocabRecite）

供站内其他页面（例如 `xxrj/` 封神之路学习档案页）读取词汇库的背词记录，用来做
「今天背了多少词 / 哪些词还不认识」这类统计与复习排程。

## 引入方式

```html
<script src="/account-store.js" defer></script>
<script src="/vocab-recite-api.js" defer></script>
```

顺序不能颠倒：`account-store.js` 会把 `localStorage` 换成一个按账号隔离的兼容层，
并把写入的键同步到 `POST /api/progress`。未登录或静态镜像下写入 `guest` 命名空间，
功能不变，只是不跨设备同步。

- 存储键：`iball_vocab_recite_v1`（实际键名前缀由 account-store 决定）
- 记录粒度：一个词库（deck）+ 一个词一条记录
- 词库 id：`llyc2027`（恋练有词 2027 备考词库）、`kaoyan`、`cet4`、`cet6`、`basic`

## 方法

| 方法 | 说明 |
| --- | --- |
| `getSnapshot()` | 整份快照 `{ version, updatedAt, records, history }` |
| `getRecords(deck?)` | 记录数组，传 deck 时只返回该词库 |
| `getRecord(deck, word)` | 单条记录或 `null` |
| `summary(deck?)` | `{ total, known, fuzzy, unknown, reviews }` |
| `daily(deck?, { days?, now? })` | 每日学习情况：`{ today, streak, totals, days, updatedAt }`，见下 |
| `record({ deck, word, status, reviewedAt?, source? })` | 记一次，`status` 取 `known` / `fuzzy` / `unknown` |
| `remove(deck, word)` | 删除一条，返回是否删除成功 |
| `clear(deck?)` | 清空某个词库；不传 deck 时清空全部 |
| `exportJson()` / `importJson(payload, { merge })` | 备份与导入，默认按 `lastAt` 合并 |
| `subscribe(listener, { immediate? })` | 订阅变更，返回取消订阅函数 |
| `statusLabel(status)` | `known` → 认识，`fuzzy` → 模糊，`unknown` → 不认识 |
| `statusBadge(status)` | 词卡角标文案，`known` → 已斩，其余同 `statusLabel` |
| `storageKey` / `statuses` / `version` | 常量 |

`daily()` 的返回结构（`days` 默认 7 天，按本地日期聚合 `history.at`）：

```json
{
  "deck": "llyc2027",
  "today": { "date": "2026-09-27", "studied": 42, "newWords": 30, "reviews": 12,
             "known": 8, "fuzzy": 6, "unknown": 4 },
  "streak": 5,
  "totals": { "studied": 1180, "known": 640, "fuzzy": 300, "unknown": 240,
              "reviews": 2200, "remaining": 6915 },
  "days": [{ "date": "2026-09-27", "label": "9/27", "weekday": "六",
             "isToday": true, "total": 42, "known": 8, "fuzzy": 6, "unknown": 4 }],
  "updatedAt": "2026-09-27T05:40:00.000Z"
}
```

背词状态里的「斩」就是 `known`：词卡上按「斩 · 已会」后该词不再排进每日任务，
统计时计入 `totals.known`，`totals.remaining` 为未斩词数。

记录字段：

```json
{
  "deck": "llyc2027",
  "word": "workforce",
  "status": "fuzzy",
  "reviews": 3,
  "firstAt": "2026-09-27T05:12:00.000Z",
  "lastAt": "2026-09-27T05:40:00.000Z",
  "source": "vocab:llyc2027"
}
```

## 示例

```js
const api = window.IballVocabRecite;

// 记一次「模糊」
api.record({ deck: "llyc2027", word: "workforce", status: "fuzzy", source: "fengshen" });

// 当前词库进度
const { total, known, unknown } = api.summary("llyc2027");

// 最近 7 天的每日学习情况（封神之路首页面板用的就是这个）
const daily = api.daily("llyc2027", { days: 7 });
console.log(daily.today.newWords, daily.streak, daily.totals.remaining);

// 今天背过的词（history 保留最近 500 次记录）
const today = new Date().toISOString().slice(0, 10);
const doneToday = api
  .getSnapshot()
  .history.filter((item) => item.at.slice(0, 10) === today);

// 词库变化时刷新界面
const unsubscribe = api.subscribe((snapshot) => {
  console.log("背词记录已更新", snapshot.updatedAt);
});
```

页面内还会派发 `window` 事件 `iball:vocab-recite`，`event.detail` 即快照，
不想管理订阅函数时可以直接监听事件。

## 词表数据

- 词库清单：`./vocab-index/deck-llyc2027.json`，含 `words` 与按 Unit 分组的 `groups`
- 词卡分片：`./vocab-index/shard-map.json` + `./vocab-index/lexemes-<n>.json`
- 点词释义：`./vocab-index/word-quick.json`

`deck-llyc2027.json` 的 `provenance` 字段说明了词头来源与版本限制：
公开渠道暂无《恋练有词 2027》官方电子词表，本站使用可获取的最新公开词头与单元顺序，
释义由 ECDict 补齐。
