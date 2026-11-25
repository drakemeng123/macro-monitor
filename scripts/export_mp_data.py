#!/usr/bin/env python3
"""把服务端最新行情导出为微信小程序使用的静态 JSON。

用法：
    python3 scripts/export_mp_data.py              # 读取服务端缓存或实时抓取
    CRON 示例：每天 09:10 运行一次，把产物提交到静态托管

输出：wechat-miniprogram/gold.json 与 wechat-miniprogram/macro.json
小程序只依赖这两个文件，因此也可以直接部署到对象存储 / CDN，不需要服务器。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as backend  # noqa: E402

OUT = ROOT / "wechat-miniprogram"
CURVE_LABELS = [("DGS1MO", "1月"), ("DGS3MO", "3月"), ("DGS6MO", "6月"), ("DGS1", "1年"),
                ("DGS2", "2年"), ("DGS5", "5年"), ("DGS10", "10年"), ("DGS30", "30年")]


def slim_metric(key: str, metric: dict) -> dict:
    history = [[d, round(v, 4)] for d, v in metric.get("history", [])][-400:]
    return {
        "key": key,
        "name": metric["name"],
        "symbol": metric["symbol"],
        "unit": metric["unit"],
        "decimals": metric.get("decimals", 2),
        "source": metric["source"],
        "value": metric.get("value"),
        "change": round(metric["change"], 4) if metric.get("change") is not None else None,
        "change_pct": round(metric["change_pct"], 4) if metric.get("change_pct") is not None else None,
        "asof": metric.get("asof"),
        "history": history,
    }


def to_mp(payload: dict) -> dict:
    """把 /api/dashboard 的完整结构裁剪成小程序要的两个 JSON。"""
    metrics = payload["metrics"]
    curve_values = {c["key"]: c["value"] for c in payload["curve"]}
    now = payload["generated_at"]
    gold = {"name": "gold", "updated": now,
            "items": [slim_metric("xau", metrics["xau"]), slim_metric("au9999", metrics["au9999"])]}
    macro = {
        "name": "macro",
        "updated": now,
        "items": [slim_metric("dxy", metrics["dxy"]), slim_metric("us10y", metrics["us10y"])],
        "curve": [{"label": label, "value": curve_values[key]}
                  for key, label in CURVE_LABELS if key in curve_values],
        "curveDate": next((c["date"] for c in payload["curve"] if c["key"] == "DGS10"), None),
        "sources": [{"name": s["name"], "usage": s["usage"], "url": s["url"]} for s in payload["sources"]],
    }
    return {"gold": gold, "macro": macro}


def build() -> dict:
    payload = backend.refresh(force=True)
    if payload.get("cached"):
        raise RuntimeError("实时抓取失败，已保留旧文件，避免把缓存伪装成当日行情")
    return to_mp(payload)


def write_to(target: Path) -> None:
    """写出 gold.json / macro.json 到指定目录（小程序工程或静态托管目录）。"""
    data = build()
    target.mkdir(parents=True, exist_ok=True)
    for name in ("gold", "macro"):
        (target / f"{name}.json").write_text(
            json.dumps(data[name], ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )


def main() -> int:
    try:
        data = build()
    except Exception as exc:  # 保留旧文件，明确退出码供 cron 告警
        print(f"导出失败：{exc}", file=sys.stderr)
        return 1
    (OUT / "gold.json").write_text(json.dumps(data["gold"], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "macro.json").write_text(json.dumps(data["macro"], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (ROOT / "data" / "mp_export.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已导出 {len(data['gold']['items']) + len(data['macro']['items'])} 个指标，更新于 {data['gold']['updated']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
