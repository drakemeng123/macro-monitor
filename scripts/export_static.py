"""生成「零服务器」静态站点：static-site/

特点：
- 不需要 Flask、不需要常开电脑，任何静态托管（GitHub Pages / Cloudflare Pages / 对象存储）都能跑
- 数据一次性抓取后写成 data/dashboard.json，页面读文件即可
- 适合配合 GitHub Actions 定时任务每天/每小时自动重建

用法：python3 scripts/export_static.py
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static-site"
SRC_STATIC = ROOT / "static"

sys.path.insert(0, str(ROOT))

MANIFEST = {
    "name": "宏观哨兵 · 每日经济数据监测",
    "short_name": "宏观哨兵",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#f5f6f2",
    "theme_color": "#173d35",
    "lang": "zh-CN",
    "icons": [{"src": "./icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable"}],
}

SW = """const CACHE='macro-sentinel-static-v1';
const ASSETS=['./','./icon.svg','./manifest.webmanifest','./data/dashboard.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request)));
});
"""


def build_page() -> str:
    html = (SRC_STATIC / "index.html").read_text(encoding="utf-8")
    # 静态托管可能部署在子路径（如 /macro-monitor/），全部改成相对路径
    html = html.replace('href="/manifest.webmanifest"', 'href="./manifest.webmanifest"')
    html = html.replace('href="/static/icon.svg"', 'href="./icon.svg"')
    html = html.replace("navigator.serviceWorker.register('/sw.js')", "navigator.serviceWorker.register('./sw.js')")
    # 明确告知前端：这是纯静态环境，不要尝试 /api/dashboard（避免无意义的 404 报错）
    marker = "  <script>\n    const state="
    if marker in html:
        html = html.replace(marker, "  <script>window.MACRO_STATIC=true;</script>\n" + marker, 1)
    return html


def main() -> None:
    from app import build_data  # 延迟导入，避免无依赖环境下报错
    from export_mp_data import to_mp
    from patch_pages import patch

    print("正在抓取行情数据…")
    payload = build_data()
    metrics = payload.get("metrics") or {}
    if len(metrics) < 4:
        raise SystemExit(f"数据不完整，仅拿到 {len(metrics)} 个指标，已中止（避免发布残缺站点）")

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "data").mkdir(parents=True)

    (OUT / "index.html").write_text(build_page(), encoding="utf-8")
    shutil.copy(SRC_STATIC / "icon.svg", OUT / "icon.svg")
    (OUT / "manifest.webmanifest").write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "sw.js").write_text(SW, encoding="utf-8")
    (OUT / "data" / "dashboard.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    # 同一份数据顺手给微信小程序用：部署后接口地址即 <站点地址>/mp
    mp = to_mp(payload)
    mp_dir = OUT / "mp"
    mp_dir.mkdir()
    for name in ("gold", "macro"):
        (mp_dir / f"{name}.json").write_text(
            json.dumps(mp[name], ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )

    # 版本号用生成时间，确保每次部署浏览器都能拿到新文件（避免看到旧快照）
    patch(OUT, payload.get("generated_at", "").replace(":", "").replace("-", "").replace("T", "-")[:13] or "v1")

    print(f"已生成 {OUT}")
    print(f"  数据时间：{payload.get('generated_at')}")
    for key, m in metrics.items():
        print(f"  {m['name']}：{m['value']} {m['unit']}（行情 {m.get('asof')}）")
    print("本地预览：cd static-site && python3 -m http.server 8090")


if __name__ == "__main__":
    main()
