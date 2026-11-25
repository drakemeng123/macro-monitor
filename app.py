from __future__ import annotations

import copy
import csv
import io
import json
import math
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CACHE_FILE = DATA_DIR / "latest.json"
SNAPSHOT_DIR = DATA_DIR / "snapshots"
STATIC_DIR = BASE_DIR / "static"
TZ = ZoneInfo("Asia/Shanghai")
CACHE_SECONDS = int(os.getenv("CACHE_SECONDS", "1800"))
REQUEST_TIMEOUT = 18

DATA_DIR.mkdir(parents=True, exist_ok=True)
SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
_lock = threading.Lock()
_memory_cache: dict | None = None
_last_refresh = 0.0

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
    "Referer": "https://finance.sina.com.cn/",
}


def fetch(url: str) -> requests.Response:
    last_error = None
    for _ in range(2):
        try:
            response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            last_error = exc
    raise last_error


def get_text(url: str, encoding: str | None = None) -> str:
    response = fetch(url)
    if encoding:
        response.encoding = encoding
    return response.text


def get_json(url: str) -> dict:
    return fetch(url).json()


def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def parse_sina() -> dict:
    raw = get_text("https://hq.sinajs.cn/list=hf_XAU,gds_AU9999,DINIW", "gb18030")
    quotes = dict(re.findall(r'hq_str_([^=]+)="([^"]*)"', raw))
    result = {}
    if quotes.get("hf_XAU"):
        p = quotes["hf_XAU"].split(",")
        result["xau"] = {"value": finite(p[0]), "previous": finite(p[7]), "time": f"{p[12]} {p[6]}"}
    if quotes.get("gds_AU9999"):
        p = quotes["gds_AU9999"].split(",")
        result["au9999"] = {"value": finite(p[0]), "previous": finite(p[7]), "time": f"{p[12]} {p[6]}"}
    if quotes.get("DINIW"):
        p = quotes["DINIW"].split(",")
        result["dxy"] = {"value": finite(p[1]), "previous": finite(p[5]), "time": f"{p[10]} {p[0]}"}
    if len(result) != 3:
        raise ValueError("新浪行情字段不完整")
    return result


def parse_gold_history() -> dict:
    data = get_json("https://www.ijinjia.com/static/data/metals.json")
    gold = data["metals"]["xau"]
    return {
        "xau": [[d, finite(v)] for d, v in gold.get("si", []) if finite(v) is not None],
        "au9999": [[d, finite(v)] for d, v in gold.get("sd", []) if finite(v) is not None],
        "updated": data.get("updated_str"),
    }


def parse_daily_macro() -> dict:
    data = get_json("https://xaudaily.com/readings.json?src=macro-monitor-h5")
    readings = data["readings"]
    dxy = readings["dxy"]
    history = [[d, finite(v)] for d, v in zip(dxy["dates"], dxy["vals"]) if finite(v) is not None]
    return {"dxy": history, "asof": dxy.get("asOf")}


def parse_fred() -> dict:
    start = (datetime.now(TZ).replace(year=datetime.now(TZ).year - 2)).strftime("%Y-%m-%d")
    ids = "DGS1MO,DGS3MO,DGS6MO,DGS1,DGS2,DGS5,DGS10,DGS30"
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={ids}&cosd={start}"
    try:
        raw = get_text(url)
    except requests.RequestException:
        # FRED 在部分网络环境会拒绝 Python TLS 连接，curl 作为同数据源降级通道。
        raw = subprocess.run(["curl", "-L", "--fail", "--max-time", "25", "-sS", url],
                             check=True, capture_output=True, text=True).stdout
    rows = list(csv.DictReader(io.StringIO(raw)))
    series = {key: [] for key in ids.split(",")}
    for row in rows:
        date = row.get("observation_date") or row.get("DATE")
        for key in series:
            value = finite(row.get(key))
            if value is not None:
                series[key].append([date, value])
    if not series["DGS10"]:
        raise ValueError("FRED 未返回美债数据")
    return series


def merge_point(history: list, date: str, value: float | None) -> list:
    if value is None or not date:
        return history
    clean = [point for point in history if point[0] != date]
    clean.append([date, value])
    return sorted(clean, key=lambda point: point[0])[-540:]


def change(value, previous):
    if value is None or previous in (None, 0):
        return None, None
    absolute = value - previous
    return absolute, absolute / previous * 100


def metric(meta, live, history):
    value = live.get("value")
    previous = live.get("previous")
    if value is None and history:
        value = history[-1][1]
    if previous is None and len(history) > 1:
        previous = history[-2][1]
    absolute, percent = change(value, previous)
    date = (live.get("time") or "")[:10]
    if date:
        history = merge_point(history, date, value)
    return {**meta, "value": value, "previous": previous, "change": absolute,
            "change_pct": percent, "asof": live.get("time") or (history[-1][0] if history else None),
            "history": history[-380:]}


def build_data() -> dict:
    errors = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {
            "sina": pool.submit(parse_sina),
            "gold": pool.submit(parse_gold_history),
            "macro": pool.submit(parse_daily_macro),
            "fred": pool.submit(parse_fred),
        }
        results = {}
        for name, job in jobs.items():
            try:
                results[name] = job.result()
            except Exception as exc:
                errors[name] = str(exc)[:180]

    if "sina" not in results or "gold" not in results or "macro" not in results or "fred" not in results:
        if _memory_cache:
            cached = copy.deepcopy(_memory_cache)
            cached["generated_at"] = datetime.now(TZ).isoformat(timespec="seconds")
            cached["cached"] = True
            cached["errors"] = errors
            return cached
        raise RuntimeError("首次数据加载失败：" + json.dumps(errors, ensure_ascii=False))

    live = results["sina"]
    gold_history = results["gold"]
    fred = results["fred"]
    y10_history = fred["DGS10"]
    latest_y10 = y10_history[-1]
    previous_y10 = y10_history[-2] if len(y10_history) > 1 else [None, None]

    metrics = {
        "xau": metric({"name": "国际金价", "symbol": "伦敦金 · XAU/USD", "unit": "美元/盎司", "decimals": 2,
                       "source": "新浪财经 / 金价网", "color": "#c48a2c"}, live.get("xau", {}), gold_history["xau"]),
        "au9999": metric({"name": "国内金价", "symbol": "上海金 · Au99.99", "unit": "元/克", "decimals": 2,
                          "source": "新浪财经 / 金价网", "color": "#d3a34e"}, live.get("au9999", {}), gold_history["au9999"]),
        "dxy": metric({"name": "美元指数", "symbol": "US Dollar Index · DXY", "unit": "点", "decimals": 2,
                       "source": "新浪财经 / XAUdaily", "color": "#527a70"}, live.get("dxy", {}), results["macro"]["dxy"]),
        "us10y": metric({"name": "美债 10 年", "symbol": "US Treasury · 10Y", "unit": "%", "decimals": 2,
                         "source": "FRED · DGS10", "color": "#6b70a8"},
                        {"value": latest_y10[1], "previous": previous_y10[1], "time": latest_y10[0]}, y10_history),
    }

    curve = []
    for key, label in [("DGS1MO", "1月"), ("DGS3MO", "3月"), ("DGS6MO", "6月"), ("DGS1", "1年"),
                       ("DGS2", "2年"), ("DGS5", "5年"), ("DGS10", "10年"), ("DGS30", "30年")]:
        points = fred.get(key, [])
        if points:
            previous = points[-2][1] if len(points) > 1 else None
            curve.append({"key": key, "label": label, "value": points[-1][1],
                          "change_bp": round((points[-1][1] - previous) * 100, 1) if previous is not None else None,
                          "date": points[-1][0]})

    generated = datetime.now(TZ)
    payload = {
        "generated_at": generated.isoformat(timespec="seconds"),
        "cached": False,
        "errors": errors,
        "metrics": metrics,
        "curve": curve,
        "next_refresh": int(time.time()) + CACHE_SECONDS,
        "sources": [
            {"name": "新浪财经", "usage": "黄金、上海金、美元指数即时行情", "url": "https://finance.sina.com.cn/"},
            {"name": "金价网", "usage": "国际与上海金历史日线", "url": "https://www.ijinjia.com/api.html"},
            {"name": "XAUdaily", "usage": "美元指数历史日线与数据校验", "url": "https://xaudaily.com/data/"},
            {"name": "FRED", "usage": "美国国债各期限日度收益率", "url": "https://fred.stlouisfed.org/"},
        ],
    }
    return payload


def save_cache(payload: dict):
    temp = CACHE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temp.replace(CACHE_FILE)
    day = datetime.now(TZ).strftime("%Y-%m-%d")
    snapshot = {key: {"value": item["value"], "change_pct": item["change_pct"], "asof": item["asof"]}
                for key, item in payload["metrics"].items()}
    (SNAPSHOT_DIR / f"{day}.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")


def refresh(force=False):
    global _memory_cache, _last_refresh
    with _lock:
        if not force and _memory_cache and time.time() - _last_refresh < CACHE_SECONDS:
            return _memory_cache
        try:
            payload = build_data()
            if not payload.get("cached"):
                save_cache(payload)
            _memory_cache = payload
            _last_refresh = time.time()
            return payload
        except Exception:
            if _memory_cache:
                return _memory_cache
            if CACHE_FILE.exists():
                _memory_cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
                _memory_cache["cached"] = True
                return _memory_cache
            raise


def refresh_loop():
    while True:
        time.sleep(CACHE_SECONDS)
        try:
            refresh(force=True)
        except Exception as exc:
            app.logger.warning("定时刷新失败：%s", exc)


@app.get("/mp-preview")
def mp_preview():
    return send_from_directory(BASE_DIR / "wechat-miniprogram", "preview.html")


@app.get("/mp/<path:filename>")
def mini_program_api(filename):
    """微信小程序 wx.request 用的静态数据接口（需部署为 HTTPS 合法域名）。"""
    return send_from_directory(BASE_DIR / "wechat-miniprogram", filename)


@app.after_request
def allow_mini_program(response):
    if request.path.startswith("/mp/"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Cache-Control"] = "public, max-age=300"
    return response


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/dashboard")
def dashboard():
    force = request.args.get("refresh") == "1"
    try:
        payload = dict(refresh(force=force))
        # 小程序用的字段别名：微信 request 不支持自定义 header 技巧，用查询参数直传
        payload.setdefault("now", payload.get("generated_at"))
        payload.setdefault("curve_date", next((c["date"] for c in payload.get("curve", []) if c.get("key") == "DGS10"), None))
        response = jsonify(payload)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Cache-Control"] = "public, max-age=120"
        return response
    except Exception as exc:
        return jsonify({"error": str(exc)}), 503


@app.get("/api/guide")
def guide():
    """上线指引页：域名、校验文件、调试开关的位置一目了然。"""
    # 注意：反代后面 request.url_root 可能是内网地址，统一用相对路径避免误导
    info = {
        "站点地址": "浏览器地址栏里的域名（去掉路径）",
        "数据接口（小程序用）": "/api/dashboard",
        "小程序也可用静态接口": "/mp/gold.json 与 /mp/macro.json",
        "健康检查": "/api/health",
        "说明": "小程序后台「服务器域名」填本站域名；若需域名校验文件，放到 static/ 目录即可通过 /<文件名> 访问",
    }
    body = "<meta charset='utf-8'><title>接口信息</title><pre style='font:14px/1.8 ui-monospace,Menlo,monospace;padding:24px'>"            + "\n".join(f"{k}：{v}" for k, v in info.items()) + "</pre>"
    return body, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.get("/<name>.txt")
def verify_file(name):
    """微信公众平台要求的域名校验文件（形如 xxxxx.txt），放在 static/ 下即可。"""
    target = STATIC_DIR / f"{name}.txt"
    if not target.exists():
        return jsonify({"error": "not found"}), 404
    return send_from_directory(STATIC_DIR, f"{name}.txt", mimetype="text/plain")


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "cache_ready": _memory_cache is not None or CACHE_FILE.exists()})


@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(STATIC_DIR, "manifest.webmanifest")


@app.get("/sw.js")
def service_worker():
    return send_from_directory(STATIC_DIR, "sw.js")


if CACHE_FILE.exists():
    try:
        _memory_cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        _last_refresh = CACHE_FILE.stat().st_mtime
    except Exception:
        _memory_cache = None

def _warm_up():
    try:
        refresh()
    except Exception as exc:
        app.logger.warning("启动刷新失败：%s", exc)


# 后台预热：先让端口立即可用（云上部署探活需要在几秒内响应），页面先显示缓存或骨架屏
threading.Thread(target=_warm_up, daemon=True).start()

if os.getenv("DISABLE_SCHEDULER") != "1":
    threading.Thread(target=refresh_loop, daemon=True).start()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8000")), debug=False)
