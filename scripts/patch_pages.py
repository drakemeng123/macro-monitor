"""给 GitHub Pages 版本打补丁：actions 每次生成的是全新静态文件，不能依赖浏览器旧缓存。

- 在 HTML 里注入版本号注释，让 Pages 部署后返回的内容必定变化
- Service Worker 缓存名带上版本号，避免用户长期看到旧快照
"""
from __future__ import annotations

import re
from pathlib import Path


def patch(site_dir: Path, version: str) -> None:
    index = site_dir / "index.html"
    html = index.read_text(encoding="utf-8")
    stamp = f"<!-- build:{version} -->"
    html = re.sub(r"<!-- build:[^>]*-->\n?", "", html)
    html = html.replace("<head>\n", f"<head>\n{stamp}\n", 1)
    index.write_text(html, encoding="utf-8")

    sw = site_dir / "sw.js"
    if sw.exists():
        code = sw.read_text(encoding="utf-8")
        code = re.sub(r"const CACHE='[^']*';", f"const CACHE='macro-sentinel-{version}';", code, count=1)
        sw.write_text(code, encoding="utf-8")
