# iball的小屋

一个按上传素材自动分组的听力词汇网站，支持 Anki CSV 和 Markdown 表格。

## 添加素材

在 GitHub 仓库中按下面的结构上传文件：

```text
materials/
  Modern Family/
    S01E01 精选 50.md
    S01E01 完整 100.md
  四级真题/
    2022年6月.csv
```

规则：

- 一级文件夹名作为分类名。
- 文件名作为素材标题，日期前缀 `2026-09-16-` 会自动移除。
- `.md` 使用 Markdown 表格解析，`.csv` 使用 Anki CSV 解析。
- 上传并提交后，Vercel 会自动执行 `npm run build`，重新生成
  `resources.json` 并部署网站。

Markdown 表格支持这些列名：

```markdown
| # | 词/短语 | 释义 | IPA | 英文原句 | 译句 |
```

Anki CSV 的 `#columns` 需要包含 `Front,Back`。

## 网站功能

- 单账号登录，不提供公开注册。
- 按上传素材切换分类。
- 收藏、不会的单词、已掌握标记。
- 浏览器直接朗读英文词汇。

## 登录配置

Vercel 项目需要设置以下 Production 环境变量：

- `APP_USERNAME`
- `APP_PASSWORD`
- `SESSION_SECRET`（至少 32 字节随机字符串）

登录接口位于 `api/auth.js`，使用签名 HttpOnly Cookie 保存会话，不需要额外数据库。
