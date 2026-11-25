/* ================= 数据接口配置 =================
   线上默认地址（GitHub Pages 静态接口，长期有效、无需凭据）
   本地调试可改成 http://127.0.0.1:8000，并在开发者工具勾选「不校验合法域名」 */
const ONLINE_API_BASE = 'https://drakemeng123.github.io/macro-monitor/mp';
const DEFAULT_API_BASE = ONLINE_API_BASE;

App({
  globalData: {
    apiBase: DEFAULT_API_BASE,
    onlineApiBase: ONLINE_API_BASE,
    useOnline: true,
    dataUpdated: ''
  },

  onLaunch() {
    const saved = wx.getStorageSync('macro_api_base');
    if (saved) {
      this.globalData.apiBase = saved;
      this.globalData.useOnline = saved === ONLINE_API_BASE;
    }
  }
});
