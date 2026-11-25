const STORAGE_KEY = 'macro_alerts_v1';
const METRIC_ORDER = ['xau', 'au9999', 'dxy', 'us10y'];

const NAVS = [
  { key: 'overview', label: '总览', icon: '/images/nav-grid.png', iconActive: '/images/nav-grid-active.png' },
  { key: 'trend', label: '趋势', icon: '/images/nav-trend.png', iconActive: '/images/nav-trend-active.png' },
  { key: 'alerts', label: '提醒', icon: '/images/nav-bell.png', iconActive: '/images/nav-bell-active.png' },
  { key: 'sources', label: '数据', icon: '/images/nav-data.png', iconActive: '/images/nav-data-active.png' }
];

function format(value, decimals) {
  if (value === null || value === undefined || isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function todayText() {
  const now = new Date();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${now.getMonth() + 1}月${now.getDate()}日${weekdays[now.getDay()]}`;
}

Page({
  data: {
    view: 'overview',
    todayDate: todayText(),
    navs: NAVS,
    metrics: [],
    metricMap: {},
    selectedKey: 'xau',
    selected: { key: 'xau', name: '国际金价', unit: '美元/盎司', decimals: 2, source: '—' },
    ranges: [
      { label: '1月', value: 30 },
      { label: '3月', value: 90 },
      { label: '6月', value: 180 },
      { label: '1年', value: 365 }
    ],
    range: 90,
    chartTitle: '国际金价 · 走势',
    chartSubtitle: '伦敦金 · XAU/USD，美元/盎司',
    periodText: '—',
    periodCls: '',
    highText: '—',
    lowText: '—',
    brief: [],
    curve: [],
    curveDate: '—',
    curveSpread: '—',
    connectionText: '监测中',
    updatedAt: '等待数据',
    heroSummary: '正在汇总黄金、美元与美债的最新信号…',
    notice: null,
    tooltip: { show: false, left: 0, top: 0, date: '', value: '' },
    alerts: [],
    triggered: [],
    alertCount: 0,
    loading: false
  },

  onLoad() {
    const app = getApp();
    this.apiBase = app.globalData.apiBase;
    this.chartPoints = [];
    this.hoverIndex = -1;
    this.payload = null;
    this.chartHeight = 0;
    this.chartWidth = 0;
    this.loadData();
  },

  onReady() {
    this.initChart();
  },

  onShow() {
    const elapsed = Date.now() - (this.loadedAt || 0);
    if (this.loadedAt && elapsed > 5 * 60 * 1000) this.loadData();
  },

  /* ---------------- 数据加载 ---------------- */
  loadData() {
    if (this.data.loading) return;
    this.setData({ loading: true, connectionText: '正在更新' });
    this.fetchAll()
      .then(({ gold, macro }) => {
        if (!gold.items || !gold.items.length) throw new Error('黄金数据为空');
        this.payload = { gold, macro };
        wx.setStorageSync('macro_cache_v1', { savedAt: Date.now(), gold, macro });
        this.renderData(gold, macro, false);
        wx.hideLoading();
        this.setData({ connectionText: '已更新', loading: false });
      })
      .catch((err) => {
        const cached = wx.getStorageSync('macro_cache_v1');
        if (cached && cached.gold) {
          this.renderData(cached.gold, cached.macro, true);
          wx.hideLoading();
          this.setData({
            connectionText: '缓存数据',
            loading: false,
            notice: { text: '接口暂时不可用，正在展示本机最近一次有效缓存。', action: '' }
          });
        } else {
          wx.hideLoading();
          this.setData({
            connectionText: '连接失败',
            loading: false,
            notice: {
              text: `暂时无法加载数据：${err.message || '网络异常'}。可在后端服务启动后重试。`,
              action: '设置接口地址'
            }
          });
        }
      });
  },

  /* 两种接口都支持：
     - 聚合接口 /api/dashboard：一次请求拿到全部指标（线上默认）
     - 静态两个 JSON（gold.json / macro.json）：把同一份数据拆开（自建静态托管时用）
     返回统一的 { gold, macro } 结构，后面的渲染逻辑无需区分 */
  fetchAll() {
    const base = this.apiBase;
    if (/\/api\/dashboard/.test(base)) {
      return this.fetchJson(base, 'dashboard').then((raw) => this.splitDashboard(raw));
    }
    return Promise.all([
      this.fetchJson(`${base}/gold.json`, 'gold'),
      this.fetchJson(`${base}/macro.json`, 'macro')
    ]).then(([gold, macro]) => ({ gold, macro }));
  },

  splitDashboard(raw) {
    // /api/dashboard 的 metrics 是 { key: {...} } 字典，字典里没有再带 key 字段，需要补上
    const dict = raw.metrics || {};
    const items = raw.items || Object.keys(dict).map((key) => Object.assign({ key }, dict[key]));
    const toItem = (m) => ({
      key: m.key,
      name: m.name,
      symbol: m.symbol,
      unit: m.unit,
      decimals: m.decimals === undefined ? 2 : m.decimals,
      source: m.source,
      value: m.value,
      change: m.change,
      change_pct: m.change_pct,
      asof: m.asof,
      history: m.history || []
    });
    const list = items.map(toItem);
    const gold = { name: 'gold', updated: raw.now || raw.generated_at, items: list.filter((i) => i.key === 'xau' || i.key === 'au9999') };
    const macro = {
      name: 'macro',
      updated: raw.now || raw.generated_at,
      items: list.filter((i) => i.key === 'dxy' || i.key === 'us10y'),
      curve: raw.curve || [],
      curveDate: raw.curve_date || '—',
      sources: raw.sources || []
    };
    return { gold, macro };
  },

  fetchJson(url, name) {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'GET',
        timeout: 12000,
        success: (res) => {
          if (res.statusCode === 200 && res.data && typeof res.data === 'object') resolve(res.data);
          else reject(new Error(`${name} 返回异常（${res.statusCode}）`));
        },
        fail: (err) => reject(new Error(err.errMsg || '网络请求失败'))
      });
    });
  },

  setApiBase() {
    wx.showModal({
      title: '设置数据接口地址',
      editable: true,
      content: this.apiBase,
      placeholderText: 'https://你的域名/api/dashboard',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const url = res.content.trim().replace(/\/+$/, '');
        const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)/.test(url);
        if (!/^https:\/\//.test(url) && !isLocal) {
          wx.showToast({ title: '需要 https 地址', icon: 'none' });
          return;
        }
        this.apiBase = url;
        getApp().globalData.apiBase = url;
        wx.setStorageSync('macro_api_base', url);
        this.setData({ notice: null });
        wx.showToast({ title: '地址已保存', icon: 'success' });
        this.loadData();
      }
    });
  },

  refreshAll() {
    this.setData({ notice: null });
    wx.showLoading({ title: '更新行情…', mask: true });
    this.loadData();
  },

  /* ---------------- 渲染 ---------------- */
  renderData(gold, macro, isCached) {
    const items = (gold.items || []).concat((macro && macro.items) || []);
    const metrics = items.map((item, index) => {
      const change = Number(item.change) || 0;
      const pct = Number(item.change_pct) || 0;
      const changeText = item.unit === '%'
        ? `${change >= 0 ? '+' : ''}${format(change * 100, 0)} bp`
        : `${pct >= 0 ? '+' : ''}${format(pct, 2)}%`;
      return {
        key: item.key,
        name: item.name,
        symbol: item.symbol,
        unit: item.unit,
        decimals: item.decimals || 2,
        source: item.source,
        value: item.value,
        valueText: format(item.value, item.decimals || 2),
        change,
        changePct: pct,
        changeText,
        changeClass: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
        asofText: (item.asof || '').slice(5, 16),
        history: item.history || [],
        spark: this.sparkDataUrl(item.history, item.key),
        index
      };
    });
    if (!metrics.length) return;

    const metricMap = {};
    metrics.forEach((m) => { metricMap[m.key] = m; });
    const selectedKey = metricMap[this.data.selectedKey] ? this.data.selectedKey : metrics[0].key;
    const xau = metricMap.xau;
    const dxy = metricMap.dxy;
    const us10y = metricMap.us10y;

    let summary = '黄金、美元与美债信号分化，继续观察跨资产联动。';
    if (xau && dxy) {
      if (xau.changePct < 0 && dxy.changePct > 0) summary = '美元走强，黄金短线承压；美债利率仍是关键变量。';
      else if (xau.changePct > 0 && dxy.changePct < 0) summary = '美元回落，黄金获得支撑；关注美债利率的后续变化。';
      else if (xau.changePct > 0 && dxy.changePct > 0) summary = '黄金与美元同向走强，市场防御需求值得关注。';
      else if (xau.changePct < 0 && dxy.changePct < 0) summary = '黄金与美元同步回落，跨资产信号仍待确认。';
    }
    const rateText = us10y ? ` 10 年美债收益率报 ${format(us10y.value, 2)}%。` : '';

    const curve = ((macro && macro.curve) || []).slice();
    const curveValues = curve.map((c) => Number(c.value));
    const curveMin = Math.min.apply(null, curveValues);
    const curveMax = Math.max.apply(null, curveValues);
    const curveSpan = (curveMax - curveMin) || 1;
    const curveRows = curve.map((c) => ({
      label: c.label,
      value: format(c.value, 2),
      percent: 30 + ((c.value - curveMin) / curveSpan) * 65
    }));
    const y2 = curve.filter((c) => c.label === '2年')[0];
    const y10 = curve.filter((c) => c.label === '10年')[0];

    const brief = [];
    if (xau && metricMap.au9999) {
      brief.push(`国际金价日内${xau.changePct >= 0 ? '上行' : '回落'} ${format(Math.abs(xau.changePct), 2)}%，国内金价${metricMap.au9999.changePct >= 0 ? '上涨' : '下跌'} ${format(Math.abs(metricMap.au9999.changePct), 2)}%。`);
    }
    if (dxy) brief.push(`美元指数${dxy.changePct >= 0 ? '走强' : '走弱'} ${format(Math.abs(dxy.changePct), 2)}%，报 ${format(dxy.value, 2)} 点。`);
    if (us10y && y2 && y10) brief.push(`10 年美债报 ${format(us10y.value, 2)}%，10Y−2Y 利差为 ${format((y10.value - y2.value) * 100, 0)} bp。`);

    const sources = ((macro && macro.sources) || []).map((s) => Object.assign({}, s, {
      status: '已接入',
      linkText: '复制数据源链接'
    }));

    this.setData({
      metrics,
      metricMap,
      selectedKey,
      selected: metricMap[selectedKey],
      heroSummary: summary + rateText,
      updatedAt: `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}${isCached ? ' · 缓存' : ''}`,
      brief,
      curve: curveRows,
      curveDate: (macro && macro.curveDate) || '—',
      curveSpread: y2 && y10 ? `${format((y10.value - y2.value) * 100, 0)} bp` : '—',
      sources,
      notice: isCached ? { text: '接口暂时不可用，正在展示本机最近一次有效缓存。', action: '设置接口地址' } : null
    }, () => {
      this.loadedAt = Date.now();
      this.renderChart();
      this.renderAlerts();
    });
  },

  sparkDataUrl(history, key) {
    const list = (history || []).slice(-24);
    if (list.length < 2) return '';
    const values = list.map((p) => Number(p[1]));
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = (max - min) || 1;
    const color = key === 'xau' || key === 'au9999' ? '#c48a2c' : key === 'dxy' ? '#527a70' : '#6b70a8';
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * 84},${29 - ((v - min) / span) * 25}`).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 86 32"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  },

  /* ---------------- 趋势图 ---------------- */
  selectMetric(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ selectedKey: key, selected: this.data.metricMap[key], tooltip: { show: false } });
    this.renderChart();
    if (this.data.view === 'overview') wx.showToast({ title: `已切换：${this.data.metricMap[key].name}`, icon: 'none' });
  },

  selectRange(e) {
    this.setData({ range: Number(e.currentTarget.dataset.range), tooltip: { show: false } });
    this.renderChart();
  },

  initChart() {
    if (this.chartQuery) return;
    this.chartQuery = wx.createSelectorQuery().in(this);
    this.chartQuery.select('#trendCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const { node, width, height } = res[0];
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2;
      this.canvasNode = node;
      this.dpr = dpr;
      node.width = width * dpr;
      node.height = height * dpr;
      this.chartCtx = node.getContext('2d');
      this.chartCtx.scale(dpr, dpr);
      this.chartReady = true;
      this.chartWidth = width;
      this.chartHeight = height;
      this.renderChart();
    });
  },

  filteredHistory() {
    const selected = this.data.metricMap[this.data.selectedKey] || this.data.selected;
    const history = selected.history || [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.data.range);
    const filtered = history.filter((p) => new Date(`${p[0]}T00:00:00`) >= cutoff);
    return filtered.length > 1 ? filtered : history;
  },

  ensureCanvasSize() {
    if (!this.canvasNode) return;
    return new Promise((resolve) => {
      wx.createSelectorQuery().in(this).select('#trendCanvas').fields({ size: true }).exec((res) => {
        const box = res && res[0];
        if (!box || !box.width || !box.height) return resolve(false);
        if (Math.abs(box.width - this.chartWidth) > 1 || Math.abs(box.height - this.chartHeight) > 1) {
          this.canvasNode.width = box.width * this.dpr;
          this.canvasNode.height = box.height * this.dpr;
          this.chartCtx.setTransform(1, 0, 0, 1, 0, 0);
          this.chartCtx.scale(this.dpr, this.dpr);
          this.chartWidth = box.width;
          this.chartHeight = box.height;
        }
        resolve(true);
      });
    });
  },

  renderChart() {
    const selected = this.data.metricMap[this.data.selectedKey] || this.data.selected || {};
    if (!selected.key) return;
    const points = this.filteredHistory();
    if (points !== this.lastPoints) this.hoverIndex = -1;
    this.lastPoints = points;
    this.setData({
      chartTitle: `${selected.name} · 走势`,
      chartSubtitle: `${selected.symbol}，${selected.unit}`,
      selected
    });
    if (points.length < 2) {
      this.chartPoints = [];
      if (this.chartCtx) this.chartCtx.clearRect(0, 0, this.chartWidth, this.chartHeight);
      return;
    }
    const values = points.map((p) => Number(p[1]));
    const first = values[0];
    const last = values[values.length - 1];
    const period = ((last - first) / first) * 100;
    this.setData({
      periodText: `${period >= 0 ? '+' : ''}${format(period, 2)}%`,
      periodCls: period >= 0 ? 'up-text' : 'down-text',
      highText: format(Math.max.apply(null, values), selected.decimals),
      lowText: format(Math.min.apply(null, values), selected.decimals)
    });
    this.chartPoints = points;
    if (!this.chartCtx) return;
    this.ensureCanvasSize().then(() => this.paintChart(points, selected));
  },

  paintChart(points, selected) {
    const ctx = this.chartCtx;
    if (!ctx || !points || !selected || !selected.key) return;
    const W = this.chartWidth;
    const H = this.chartHeight;
    const pad = { l: 6, r: 48, t: 10, b: 22 };
    const ch = H - pad.t - pad.b;
    const cw = W - pad.l - pad.r;
    const values = points.map((p) => Number(p[1]));
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const spread = (max - min) || 1;
    const yMin = min - spread * 0.08;
    const yMax = max + spread * 0.08;
    const x = (i) => pad.l + (i / (points.length - 1)) * cw;
    const y = (v) => pad.t + ((yMax - v) / (yMax - yMin)) * ch;
    const color = selected.key === 'us10y' ? '#6b70a8' : selected.key === 'dxy' ? '#527a70' : '#c48a2c';

    ctx.clearRect(0, 0, W, H);
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 5; i += 1) {
      const gy = pad.t + (i / 4) * ch;
      const gv = yMax - (i / 4) * (yMax - yMin);
      ctx.strokeStyle = '#e8ece6';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(W - pad.r, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#87938d';
      ctx.textAlign = 'left';
      ctx.fillText(format(gv, selected.decimals), W - pad.r + 7, gy);
    }

    ctx.beginPath();
    points.forEach((p, i) => {
      const px = x(i);
      const py = y(Number(p[1]));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.lineTo(x(points.length - 1), pad.t + ch);
    ctx.lineTo(x(0), pad.t + ch);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
    fill.addColorStop(0, `${color}3d`);
    fill.addColorStop(1, `${color}05`);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    points.forEach((p, i) => {
      const px = x(i);
      const py = y(Number(p[1]));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.fillStyle = '#87938d';
    ctx.textBaseline = 'alphabetic';
    [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach((idx, n) => {
      ctx.textAlign = n === 0 ? 'left' : n === 2 ? 'right' : 'center';
      ctx.fillText(points[idx][0].slice(5), x(idx), H - 4);
    });
    this.drawHover();
  },

  onTouch(e) {
    if (!this.chartPoints.length || !e.touches.length) return;
    this.hoverX = e.touches[0].x;
    this.drawHover();
  },

  onTouchEnd() {
    this.hoverX = null;
    this.setData({ tooltip: { show: false, left: 0, top: 0, date: '', value: '' } });
    if (this.chartCtx) this.renderChart();
  },

  drawHover() {
    if (this.hoverX === null || this.hoverX === undefined || !this.chartCtx) return;
    if (!this.data.selected || !this.data.selected.key || !this.chartPoints.length) return;
    const points = this.chartPoints;
    const W = this.chartWidth;
    const H = this.chartHeight;
    const pad = { l: 6, r: 48, t: 10, b: 22 };
    const cw = W - pad.l - pad.r;
    const ch = H - pad.t - pad.b;
    const values = points.map((p) => Number(p[1]));
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const spread = (max - min) || 1;
    const yMin = min - spread * 0.08;
    const yMax = max + spread * 0.08;
    let idx = Math.round(((this.hoverX - pad.l) / cw) * (points.length - 1));
    idx = Math.max(0, Math.min(points.length - 1, idx));
    if (idx === this.hoverIndex) return;
    this.hoverIndex = idx;
    this.renderChartBase();
    const ctx = this.chartCtx;
    const px = pad.l + (idx / (points.length - 1)) * cw;
    const py = pad.t + ((yMax - values[idx]) / (yMax - yMin)) * ch;
    ctx.strokeStyle = '#94a29b';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, pad.t);
    ctx.lineTo(px, pad.t + ch);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = this.data.selectedKey === 'us10y' ? '#6b70a8' : this.data.selectedKey === 'dxy' ? '#527a70' : '#c48a2c';
    ctx.lineWidth = 2;
    ctx.stroke();
    this.setData({
      tooltip: {
        show: true,
        left: Math.max(12, Math.min(88, (px / W) * 100)),
        top: Math.max(16, (py / H) * 100),
        date: points[idx][0],
        value: format(values[idx], this.data.selected.decimals)
      }
    });
  },

  renderChartBase() {
    // 重绘底图但不重新触发 tooltip，避免递归
    const points = this.chartPoints;
    if (!points || !this.chartCtx) return;
    const savedHover = this.hoverX;
    this.hoverX = null;
    const ctx = this.chartCtx;
    const W = this.chartWidth;
    const H = this.chartHeight;
    ctx.clearRect(0, 0, W, H);
    const pad = { l: 6, r: 48, t: 10, b: 22 };
    const cw = W - pad.l - pad.r;
    const ch = H - pad.t - pad.b;
    const values = points.map((p) => Number(p[1]));
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const spread = (max - min) || 1;
    const yMin = min - spread * 0.08;
    const yMax = max + spread * 0.08;
    const x = (i) => pad.l + (i / (points.length - 1)) * cw;
    const y = (v) => pad.t + ((yMax - v) / (yMax - yMin)) * ch;
    const color = this.data.selectedKey === 'us10y' ? '#6b70a8' : this.data.selectedKey === 'dxy' ? '#527a70' : '#c48a2c';
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 5; i += 1) {
      const gy = pad.t + (i / 4) * ch;
      ctx.strokeStyle = '#e8ece6';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(W - pad.r, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#87938d';
      ctx.textAlign = 'left';
      ctx.fillText(format(yMax - (i / 4) * (yMax - yMin), this.data.selected.decimals), W - pad.r + 7, gy);
    }
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(x(i), y(Number(p[1]))); else ctx.lineTo(x(i), y(Number(p[1])));
    });
    ctx.lineTo(x(points.length - 1), pad.t + ch);
    ctx.lineTo(x(0), pad.t + ch);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
    fill.addColorStop(0, `${color}3d`);
    fill.addColorStop(1, `${color}05`);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(x(i), y(Number(p[1]))); else ctx.lineTo(x(i), y(Number(p[1])));
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#87938d';
    ctx.textBaseline = 'alphabetic';
    [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach((idx, n) => {
      ctx.textAlign = n === 0 ? 'left' : n === 2 ? 'right' : 'center';
      ctx.fillText(points[idx][0].slice(5), x(idx), H - 4);
    });
    this.hoverX = savedHover;
  },

  /* ---------------- 提醒 ---------------- */
  defaultAlert(key) {
    const base = key === 'us10y' ? 5 : key === 'dxy' ? 0.5 : 1;
    return { enabled: false, threshold: base };
  },

  renderAlerts() {
    const saved = wx.getStorageSync(STORAGE_KEY) || {};
    const alerts = METRIC_ORDER.map((key) => {
      const m = this.data.metricMap[key];
      if (!m) return null;
      const conf = Object.assign(this.defaultAlert(key), saved[key] || {});
      return {
        key,
        name: m.name,
        current: `${m.valueText} ${m.unit}`,
        enabled: conf.enabled,
        threshold: conf.threshold,
        unitText: key === 'us10y' ? 'bp' : '%'
      };
    }).filter(Boolean);
    this.savedAlerts = {};
    METRIC_ORDER.forEach((key) => {
      this.savedAlerts[key] = Object.assign(this.defaultAlert(key), saved[key] || {});
    });
    this.setData({ alerts }, () => this.evaluateAlerts());
  },

  evaluateAlerts() {
    const triggered = [];
    this.data.alerts.forEach((a) => {
      if (!a.enabled) return;
      const m = this.data.metricMap[a.key];
      if (!m) return;
      const value = a.key === 'us10y' ? Math.abs(m.change * 100) : Math.abs(m.changePct);
      if (value >= Number(a.threshold)) {
        triggered.push({
          name: m.name,
          text: `当前日波动 ${format(value, a.key === 'us10y' ? 0 : 2)} ${a.unitText}，已达到设定的 ${a.threshold} ${a.unitText}。`
        });
      }
    });
    this.setData({ triggered, alertCount: triggered.length });
  },

  toggleAlert(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.savedAlerts = this.savedAlerts || {};
    const conf = Object.assign(this.defaultAlert(key), this.savedAlerts[key] || {});
    conf.enabled = value;
    this.savedAlerts[key] = conf;
    wx.setStorageSync(STORAGE_KEY, this.savedAlerts);
    const alerts = this.data.alerts.map((a) => (a.key === key ? Object.assign({}, a, { enabled: value }) : a));
    this.setData({ alerts }, () => this.evaluateAlerts());
  },

  changeThreshold(e) {
    const key = e.currentTarget.dataset.key;
    const value = Number(e.detail.value);
    if (!value || value <= 0) {
      wx.showToast({ title: '请输入大于 0 的阈值', icon: 'none' });
      this.renderAlerts();
      return;
    }
    this.savedAlerts = this.savedAlerts || {};
    const conf = Object.assign(this.defaultAlert(key), this.savedAlerts[key] || {});
    conf.threshold = value;
    this.savedAlerts[key] = conf;
    wx.setStorageSync(STORAGE_KEY, this.savedAlerts);
    const alerts = this.data.alerts.map((a) => (a.key === key ? Object.assign({}, a, { threshold: value }) : a));
    this.setData({ alerts });
  },

  saveAlerts() {
    wx.setStorageSync(STORAGE_KEY, this.savedAlerts || {});
    this.renderAlerts();
    wx.showToast({ title: '提醒设置已保存', icon: 'success' });
  },

  /* ---------------- 其它交互 ---------------- */
  switchView(e) {
    const view = e.currentTarget.dataset.key;
    this.setData({ view });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    if (view === 'alerts') this.renderAlerts();
    if (view === 'overview' || view === 'trend') this.renderChart();
  },

  copyCsv() {
    const selected = this.data.metricMap[this.data.selectedKey] || this.data.selected;
    const rows = this.filteredHistory().map((p) => `${p[0]},${p[1]}`);
    const content = [`date,value,${selected.unit}`].concat(rows).join('\n');
    wx.setClipboardData({
      data: content,
      success: () => wx.showToast({ title: 'CSV 已复制', icon: 'success' })
    });
  },

  copySource(e) {
    const url = e.currentTarget.dataset.url;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' })
    });
  },

  onShareAppMessage() {
    return {
      title: '宏观哨兵 · 每日黄金、美元与美债监测',
      path: '/pages/index/index'
    };
  }
});
