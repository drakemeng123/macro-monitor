# 宏观哨兵 · 每日经济数据监测

手机优先的宏观行情看板，覆盖**国际金价、国内金价、美元指数、美债收益率**四项核心指标，支持趋势图、期限结构、涨跌提醒与 CSV 导出。

数据全部来自公开接口，接口异常时展示最近一次有效缓存，不用估算值填补。

## 两种运行方式

| 方式 | 需要什么 | 适合谁 |
|---|---|---|
| **GitHub Pages 静态版**（推荐长期使用） | 什么都不用，电脑可以关机 | 只想在手机上看数据 |
| **本地 / 服务器运行** | Python 3.9+，电脑需开着 | 想要 30 分钟级实时刷新、自己改数据源 |

---

## 一、GitHub Pages 部署（免费、免备案、地址固定）

本仓库已内置 `.github/workflows/pages.yml`，推到 GitHub 之后会自动：

- 每天北京时间 **09:00 / 17:00** 抓取行情（也可手动触发）
- 生成静态站点并发布到 Pages
- 顺带更新小程序用的 JSON

只需三步：

1. **Fork 或导入本仓库**到自己的 GitHub 账号
2. 打开仓库 **Settings → Pages**，`Source` 选 **GitHub Actions**
   （workflow 里已带 `enablement: true`，多数情况会自动开启，无需手点）
3. 到 **Actions** 标签页，选「更新行情并发布静态站点」→ **Run workflow**

等 1–2 分钟，站点地址为：

```
https://<你的用户名>.github.io/<仓库名>/
```

> 如果仓库根目录不是本项目（例如放在子目录 `macro-monitor/`），在 workflow 的
> 「抓取行情」与「同时更新小程序数据文件」两步加上 `working-directory: macro-monitor`。

> 免费账号的定时任务在仓库连续 60 天无提交后会被暂停，进 Actions 页点一次
> 「Enable workflow」即可恢复，也可以手动 Run 一次。

### 修改更新频率

编辑 `.github/workflows/pages.yml` 里的 cron（**UTC 时间**，北京时间减 8 小时）：

```yaml
- cron: "0 1,9 * * *"   # 09:00 / 17:00（北京）
- cron: "0 */2 * * *"   # 每 2 小时
```

---

## 二、本地运行

```bash
python3 run.py            # 自动装依赖、启动并打开浏览器
```

其他方式：

```bash
pip install -r requirements.txt && python3 app.py     # 手动启动，端口 8000
docker build -t macro-sentinel . && docker run -p 8000:8000 macro-sentinel
```

手机与电脑连同一 Wi-Fi，访问 `http://电脑局域网IP:8000`，Safari / Chrome 可「添加到主屏幕」。

> 启动会自动抓一次数据，之后每 30 分钟刷新；首屏首次可能要几秒。

### 手动生成静态站点

```bash
python3 scripts/export_static.py      # 产出 static-site/
cd static-site && python3 -m http.server 8090
```

`static-site/` 只有几个文件，可直接拖到 Cloudflare Pages、Netlify、腾讯云 COS、阿里云 OSS：

| 文件 | 作用 |
|---|---|
| `index.html` | 整个看板（样式、脚本、图表全内联） |
| `data/dashboard.json` | 当前行情快照 |
| `mp/gold.json`、`mp/macro.json` | 微信小程序的数据接口，地址即 `<站点>/mp` |
| `icon.svg`、`manifest.webmanifest`、`sw.js` | 图标、添加到主屏幕、离线缓存 |

---

## 三、微信小程序

`wechat-miniprogram/` 是原生小程序工程，**默认接口已指向线上**，导入后可立即看到真实行情。

```text
macro-monitor/
├── app.py                       # Flask 后端：抓取、缓存、日快照、/api 与 /mp
├── run.py                       # 本地一键启动
├── requirements.txt / Dockerfile
├── static/                      # 网页版前端
├── static-site/                 # 静态版产物（Pages 发布的就是这个目录）
├── data/                        # 运行时缓存与每日快照
├── scripts/
│   ├── export_static.py         # 生成静态站点（含小程序 JSON）
│   ├── export_mp_data.py        # 只导出小程序 JSON
│   └── patch_pages.py           # 给静态站点打版本号（防缓存）
├── .github/workflows/pages.yml  # 定时抓数据 + 发布 Pages
└── wechat-miniprogram/          # 微信小程序工程 ← 开发者工具导入这个目录
```

注册 AppID、配置服务器域名、上传提审、常见报错，见
**[`wechat-miniprogram/README-wechat.md`](wechat-miniprogram/README-wechat.md)**。

---

## 四、数据来源

| 指标 | 来源 |
|---|---|
| 国际金价 XAU/USD | 新浪财经 |
| 上海金 Au99.99 | 新浪财经 / 东方财富 |
| 美元指数 DXY | 新浪财经 |
| 美债各期限收益率 | 美联储 FRED |
| 历史日线 | 金价网 |

## 五、免责声明

行情可能延迟，免费公开接口可能调整或限流。本工具仅用于个人信息整理与宏观观察，**不构成任何投资建议**。
上海金 Au99.99 与品牌金饰零售价不是同一价格口径。
