#!/usr/bin/env python3
"""宏观哨兵本地一键启动：自动检查依赖并打开浏览器。"""
import os
import sys
import threading
import webbrowser

REQUIRED = {"flask": "Flask>=3.0,<4", "requests": "requests>=2.31,<3"}


def ensure_deps() -> bool:
    missing = []
    for module, package in REQUIRED.items():
        try:
            __import__(module)
        except ImportError:
            missing.append(package)
    if not missing:
        return True
    print("缺少依赖：" + " ".join(missing))
    try:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", *missing])
        return True
    except Exception:
        print("自动安装失败，请手动运行：pip install " + " ".join(missing))
        return False


def main() -> None:
    port = os.getenv("PORT", "8000")
    if not ensure_deps():
        sys.exit(1)
    if os.getenv("OPEN_BROWSER", "1") == "1":
        threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    print(f"\n宏观哨兵已启动：http://127.0.0.1:{port}")
    print("按 Ctrl+C 停止服务\n")
    from app import app
    app.run(host="127.0.0.1", port=int(port), debug=False)


if __name__ == "__main__":
    main()
