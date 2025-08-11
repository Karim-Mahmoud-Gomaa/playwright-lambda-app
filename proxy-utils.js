// proxy-utils.js
const axios = require('axios');

/**
* يحوّل رد الـAPI إلى صيغة موحّدة:
*  - server: 'http://host:port'
*  - username, password (اختياري)
*  - arg: '--proxy-server=http://host:port'
*  - url: 'http://user:pass@host:port' (لو احتجته)
*/
function normalizeProxy(data) {
  if (!data) throw new Error('Empty proxy payload');
  
  let url = (data.url || '').trim();
  
  if (!url) {
    const type = (data.type || 'http').toLowerCase();
    const host = String(data.host || '').trim();
    const port = String(data.port || '').trim();
    if (!host || !port) throw new Error('Missing proxy host/port');
    
    const hasAuth = !!(data.username || data.password);
    const u = encodeURIComponent(data.username || '');
    const p = encodeURIComponent(data.password || '');
    url = hasAuth ? `${type}://${u}:${p}@${host}:${port}` : `${type}://${host}:${port}`;
  }
  
  const u = new URL(url);
  const server = `${u.protocol}//${u.hostname}:${u.port}`;
  const username = u.username || (data.username || undefined);
  const password = u.password || (data.password || undefined);
  
  const proxy = { server };
  if (username) proxy.username = username;
  if (password) proxy.password = password;
  
  return {
    proxy,                          // للاستخدام في playwright.launch({ proxy })
    arg: `--proxy-server=${server}`,// للاستخدام ضمن args
    url,                            // إذا احتجته
    meta: { host: u.hostname, port: u.port, protocol: u.protocol.replace(':','') }
  };
}

/** يجلب بروكسي جديد من API الخاص بك */
async function getNewProxy() {
  const endpoint = process.env.SERVER_URL+'/api/get_new_proxy';
  
  if (!endpoint) throw new Error('SERVER_URL is not set');
  
  const { data } = await axios.post(endpoint, {}, { timeout: 15000 });
  return normalizeProxy(data);
}

/**
* TODO: منطق تقييم البروكسي — ضع API calls هنا (IPQualityScore, IPinfo, IP2Proxy, AbuseIPDB…)
* يجب أن تعيد:
*  { ok: boolean, score: number, reason?: string, ip?: string, country?: string }
*/
async function scoreProxy(norm) {
  // ====== ضع منطقك هنا ======
  // مثال مبدئي (Placeholder): اعتباره دائمًا جيد
  return { ok: true, score: 0, reason: 'placeholder' };
  
  // مثال هيكل متقدم (تعليق فقط):
  // 1) اكتشف IP عبر البروكسي (ipapi/ipify) باستخدام Proxy Agent
  // 2) اسأل مزودين (IPQS/IPinfo) وادمج النتائج
  // 3) ok = (country == 'US') && (fraud_score < 80) && !vpn/proxy/hosting
}

/**
* يحاول إحضار بروكسي “جيد” بعدة محاولات:
* @param {Object} opts
*  - maxAttempts: أقصى عدد محاولات
*  - cooldownMs: فترة انتظار بين المحاولات
*/
async function getGoodProxy(opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 5;
  const cooldownMs = opts.cooldownMs ?? 1000;
  
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const candidate = await getNewProxy();
      const verdict = await scoreProxy(candidate);
      
      console.log(`Proxy attempt ${attempt}/${maxAttempts}`, {
        server: candidate.proxy.server,
        hasAuth: !!candidate.proxy.username,
        verdict
      });
      
      if (verdict.ok) {
        return { ...candidate, verdict };
      }
      
      lastError = new Error(`Bad proxy: ${verdict.reason || 'low score'}`);
      // backoff بسيط + jitter
      const wait = cooldownMs + Math.floor(Math.random() * 300);
      await new Promise(r => setTimeout(r, wait));
    } catch (err) {
      lastError = err;
      const wait = cooldownMs + Math.floor(Math.random() * 300);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  
  throw lastError || new Error('Failed to acquire a good proxy');
}

module.exports = { getNewProxy, getGoodProxy, scoreProxy, normalizeProxy };
