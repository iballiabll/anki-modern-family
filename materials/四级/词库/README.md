# 四级词库

- `四级单词表.csv`：按 ECDICT 的 `cet4` 标签导出，每 50 词自动切分为一个单元。
- `四级短语表.csv`：来源 2ndLA/english-phrases 的四级短语表，每 50 条自动切分为一个单元。

## 数据来源

- 单词释义与音标：ECDICT（MIT License）https://github.com/skywind3000/ECDICT
- 短语清单：english-phrases（CC BY-SA 4.0）https://github.com/2ndLA/english-phrases
- 短语释义：优先匹配 ECDICT 词条，未收录的短语使用有道词典补录，缓存在 `data/phrase-meanings.json`。

重新生成：

```powershell
node scripts/build-vocabulary-library.mjs
```

离线重建（只使用已有缓存，不访问有道）：

```powershell
node scripts/build-vocabulary-library.mjs --offline
```

脚本默认从系统临时目录读取 `ecdict.csv`、`cet4-phrases.txt`、`cet6-phrases.txt`、`npee-phrases.txt`，
也可以用环境变量 `ECDICT_CSV`、`CET4_PHRASES`、`CET6_PHRASES`、`KY_PHRASES` 指定路径。
