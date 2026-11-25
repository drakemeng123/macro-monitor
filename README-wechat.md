# 微信小程序工程说明

本目录可直接用「微信开发者工具 → 导入项目」打开。

## 三步跑起来

1. 启动后端（在上一级目录）：`python3 run.py`
2. 打开微信开发者工具 → 导入项目 → 选择本目录 → AppID 选「测试号」
3. 右上角「详情 → 本地设置」勾选 **不校验合法域名**，编译即可看到行情

接口地址默认 `http://127.0.0.1:8000/mp`（也可用静态托管，见文末），在 `app.js` 的 `DEFAULT_API_BASE` 修改，
或在「数据」页底部输入框里改（保存在手机本地）。

## 上线前

- 换成你自己的 AppID（`project.config.json`）
- 数据接口必须是 **HTTPS + 已备案域名**，并加入小程序后台「服务器域名 → request 合法域名」
- 不想自己维护服务器：把 `gold.json`、`macro.json` 上传到对象存储/CDN，接口地址填 CDN 目录即可
- 每日更新：服务器 crontab 跑 `python3 scripts/export_mp_data.py`
- 没有服务器：跑 `python3 scripts/export_static.py`，把 `static-site/` 发到 GitHub Pages / 对象存储，
  小程序接口填 `https://你的站点/mp`（该目录已包含 gold.json 与 macro.json）
- 订阅消息推送需要额外做服务端 + 用户授权，当前版本为前台检测提醒
