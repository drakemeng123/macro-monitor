/* ================= 数据接口配置 =================
   线上默认地址（已部署，带访问凭据 sharecode，必须整条保留）
   本地调试可改成 http://127.0.0.1:8000，并在开发者工具勾选「不校验合法域名」 */
const ONLINE_API_BASE = 'https://a88818a225005d7a1.app.workbuddy.host/api/dashboard?sharecode=GNZYA6LUMZ';
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
