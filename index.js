'use strict';

require('dotenv').config();
const { chromium, request } = require('playwright');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');
const { getGoodProxy } = require('./proxy-utils');
const CheckTrustIp = require('./CheckTrustIp');
const RecaptchaSolver = require('./recaptcha/captchaSolver');
const axios = require('axios');

const fs = require('fs');
function sinceMs(s) { return `${Date.now() - s}ms`; }
function log(tag, data) { console.log(`[${tag}]`, typeof data === 'string' ? data : JSON.stringify(data)); }

// طبّع البروكسي لـ Chromium (تجنّب https://)
function normalizeProxyForChromium(p) {
  if (!p?.server) return p;
  return { ...p, server: p.server.replace(/^https:\/\//i, 'http://') };
}

// كشف الـ IP/Timezone عبر نفس البروكسي لكن بدون متصفح
async function detectViaProxyViaRequest(proxy) {
  const rc = await request.newContext({ proxy, timeout: 30000 });
  try {
    const resp = await rc.get('https://ipapi.co/json/');
    log('DETECT', { status: resp.status(), ok: resp.ok() });
    if (!resp.ok()) return null;
    const meta = await resp.json().catch(() => null);
    if (!meta) return null;
    return {
      timezoneId: meta.timezone || 'America/New_York',
      geo: (meta.latitude && meta.longitude)
      ? { latitude: meta.latitude, longitude: meta.longitude, accuracy: 50 }
      : { latitude: 40.7128, longitude: -74.0060, accuracy: 50 },
      ip: meta.ip, country: meta.country, region: meta.region, city: meta.city
    };
  } finally { await rc.dispose().catch(() => {}); }
}

// -------------------------
// Helpers & Logging
// -------------------------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
function since() { return `${Date.now() - t0}ms`; }

const US_DEFAULT = {
  locale: 'en-US',
  acceptLanguage: 'en-US,en;q=0.9',
  timezoneId: 'America/New_York',
  geo: { latitude: 40.7128, longitude: -74.0060, accuracy: 50 },
};

// -------------------------
// Detection via Playwright request context (no browser needed)
// -------------------------
async function detectViaProxyViaRequest(proxy) {
  const rc = await request.newContext({ proxy, timeout: 30000 });
  try {
    log('DETECT', 'calling ipapi.co/json via request context');
    const resp = await rc.get('https://ipapi.co/json/');
    log('DETECT', { status: resp.status(), ok: resp.ok() });
    
    if (!resp.ok()) {
      const text = await resp.text().catch(() => '<read text failed>');
      log('DETECT', { bodyPreview: text?.slice?.(0, 500) });
      return null;
    }
    
    let meta = null;
    try {
      meta = await resp.json();
    } catch (e) {
      const text = await resp.text().catch(() => '<read text failed>');
      log('DETECT', { jsonParseError: String(e), bodyPreview: text?.slice?.(0, 500) });
      return null;
    }
    
    const fallbackGeo = { latitude: 40.7128, longitude: -74.0060, accuracy: 50 };
    const out = {
      timezoneId: meta.timezone || 'America/New_York',
      geo: meta.latitude && meta.longitude ? { latitude: meta.latitude, longitude: meta.longitude, accuracy: 50 } : fallbackGeo,
      ip: meta.ip,
      country: meta.country,
      region: meta.region,
      city: meta.city,
    };
    log('DETECT', out);
    return out;
  } catch (e) {
    log('DETECT-ERR', String(e));
    return null;
  } finally {
    await rc.dispose().catch(() => {});
  }
}

async function saveAccount(data) {
  try {
    const { data: resp } = await axios.post(`${process.env.SERVER_URL}/api/save_accounts`, { ...data, type_id: 1 });
    return !!resp?.success;
  } catch (e) {
    console.error('saveAccount error:', e.message);
    return false;
  }
}

async function findText(page, text, selector = null, timeout = 3000) {
  try {
    const lowerText = text.toLowerCase();
    if (selector && typeof selector === 'string') {
      return await page.waitForFunction(
        (txt, sel) => Array.from(document.querySelectorAll(sel)).some((el) => el.innerText.toLowerCase().includes(txt)),
        { timeout },
        lowerText,
        selector,
      );
    } else {
      return await page.waitForFunction(
        (txt) => document.body && document.body.innerText.toLowerCase().includes(txt),
        { timeout },
        lowerText,
      );
    }
  } catch (e) {
    console.error(`findText("${text}") error:`, e.message);
    return false;
  }
}

async function getCode(email, retries = 3, waitMs = 20000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      log('getCode', { attempt, email });
      const { data } = await axios.post(`${process.env.SERVER_URL}/api/get_code`, { email });
      const code = data?.code || null;
      
      if (code) {
        log('getCode', { attempt, found: true });
        return code;
      } else {
        log('getCode', { attempt, found: false });
      }
    } catch (e) {
      console.error(`getCode error (attempt ${attempt}):`, e.message);
    }
    
    if (attempt < retries) {
      log('getCode', `waiting ${waitMs}ms before retry ${attempt + 1}/${retries}...`);
      await delay(waitMs);
    }
  }
  return null;
}

async function CreateAccount(page, profileData) {
  const { name, email, password } = profileData;
  try {
    log('CREATE', 'navigating to homepage');
    await page.goto('https://www.quora.com/', { waitUntil: 'domcontentloaded', timeout: 120000 });
    
    await delay(5000);
    const signUpBtnLoc = page.locator('text=Sign up with email');
    const visible = await signUpBtnLoc.isVisible();
    log('CREATE', { signUpVisible: visible });
    if (!visible) return false;
    
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Sign up with email/i.test(b.innerText));
      btn?.click();
    });
    
    await page.waitForSelector('input[name="email"]', { visible: true, timeout: 60000 });
    await delay(2000);
    await page.type('input[name="profile-name"]', name, { delay: 80 });
    await delay(500);
    await page.type('input[name="email"]', email, { delay: 80 });
    
    const day = await page.$$('input[name="day"]');
    if (day.length) {
      await page.type('input[name="day"]', String(Math.floor(Math.random() * 30) + 1), { delay: 60 });
      await page.type('input[name="month"]', String(Math.floor(Math.random() * 12) + 1), { delay: 60 });
      await page.type('input[name="year"]', String(Math.floor(Math.random() * 30) + 1990), { delay: 60 });
    }
    
    if (await page.locator('text=Please contact us if you think this is an error.').isVisible()) return false;
    
    await delay(1000);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Next/i.test(b.innerText));
      btn?.click();
    });
    
    // احصل على كود البريد
    let code = await getCode(email);
    log('CREATE code from server : ', { code });
    if (!code) return false;
    
    await page.type('input[name="confirmationCode"]', code, { delay: 80 });
    await delay(800);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Next/i.test(b.innerText) && !b.disabled);
      btn?.click();
    });
    
    await page.waitForSelector('input[name="password"]', { visible: true, timeout: 60000 });
    await page.type('input[name="password"]', password, { delay: 80 });
    
    // ملاحظة: تأكد أن استخدام أي محلّل CAPTCHA متوافق مع القوانين وشروط الموقع.
    const solver = new RecaptchaSolver(process.env.RECAPTCHA_KEY);
    const solved = await solver.solve(page);
    log('CREATE', { recaptchaSolved: solved });
    if (!solved) return false;
    
    await delay(1000);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => /Finish|Next/i.test(b.innerText) && !b.disabled);
      btns.forEach((b) => b.click());
    });
    
    // اختيارات اهتمامات (متسامحة مع الفشل)
    try {
      await page.waitForSelector('.puppeteer_test_follow_interests_list_item', { visible: true, timeout: 30000 });
      const items = await page.$$('.puppeteer_test_follow_interests_list_item');
      for (const i of (items || []).slice(0, 6)) {
        await i.click();
        await delay(200);
      }
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /Done|Next/i.test(b.innerText) && !b.disabled);
        btn?.click();
      });
    } catch {}
    
    // لغات إضافية (إن ظهرت)
    if (await findText(page, 'What other languages do you know', null, 10000)) {
      await page.evaluate(() => {
        [...document.querySelectorAll('div')]
        .filter((d) => /Done/i.test(d.innerText))
        .forEach((d) => d.click());
      });
    }
    
    await delay(5000);
    const isHome = await page.evaluate(() =>
      [...document.querySelectorAll('div')].some((d) => /What do you want to ask or share\?/i.test(d.innerText)),
  );
  
  if (isHome) {
    const scripts = await page.$$eval('script[type="text/javascript"]', (els) =>
      els.map((e) => e.textContent).filter((txt) => txt.includes('profileUrl')),
  );
  if (scripts.length) {
    const m = scripts[0].match(/push\("(.+?)"\)/);
    if (m) {
      const jsonString = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      try {
        const data = JSON.parse(jsonString);
        const profileUrl = data?.data?.viewer?.user?.profileUrl;
        if (profileUrl) {
          const finalUrl = `https://www.quora.com${profileUrl}`;
          await saveAccount({ name, email, password, profile_url: finalUrl });
          return true;
        }
      } catch {}
    }
  }
}

return true;
} catch (err) {
  console.error('CreateAccount error:', err.message);
  return false;
}
}

async function runOnce(attempt) {
  const ROTATE_RETRIES = 3;
  const ROTATE_WAIT_MS = 5000;
  
  let browser, workContext;
  
  try {
    for (let rot = 1; rot <= ROTATE_RETRIES; rot++) {
      // 1) جيب بروكسي جديد لكل محاولة
      const { proxy } = await getGoodProxy({ maxAttempts: 5, cooldownMs: 1200 });
      const proxyForChromium = normalizeProxyForChromium(proxy); // لو عندك دالة تطبيع http://
      
      // (اختياري) حدّث الـ loc من ipapi لنفس البروكسي
      const detection = await detectViaProxyViaRequest(proxy).catch(() => null);
      const loc = {
        timezoneId: detection?.timezoneId || US_DEFAULT.timezoneId,
        geo: detection?.geo || US_DEFAULT.geo
      };
      
      // 2) أغلق أي متصفح/سياق سابقين قبل ما تعيد الإنشاء
      if (workContext) { try { await workContext.close(); } catch {} workContext = null; }
      if (browser)     { try { await browser.close(); } catch {} browser = null; }
      
      // 3) شغّل المتصفح بهذا البروكسي
      const launchArgs = [
        '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
        '--no-first-run','--no-default-browser-check','--lang=en-US',
        '--no-zygote','--disable-gpu','--disable-software-rasterizer','--disable-extensions'
      ];
      browser = await chromium.launch({ headless: true, args: launchArgs, proxy: proxyForChromium });
      
      // 4) أنشئ سياق وبصمة/هيدرز لكل محاولة (يناسب الـ IP الجديد)
      const gen = new FingerprintGenerator({
        browsers: ['chrome'], devices: ['desktop'],
        operatingSystems: ['windows'], locales: [US_DEFAULT.locale]
      });
      const fpWithHeaders = gen.getFingerprint({ locales: [US_DEFAULT.locale, 'en'] });
      const { fingerprint, headers } = fpWithHeaders;
      
      workContext = await browser.newContext({
        userAgent: fingerprint.userAgent,
        locale: US_DEFAULT.locale,
        timezoneId: loc.timezoneId,
        viewport: fingerprint.screen,
        deviceScaleFactor: fingerprint.screen?.deviceScaleFactor || 1,
        geolocation: loc.geo,
        permissions: ['geolocation']
      });
      
      await workContext.setExtraHTTPHeaders({
        'Accept-Language': headers?.['accept-language'] || US_DEFAULT.acceptLanguage,
        'Sec-CH-UA': headers?.['sec-ch-ua'],
        'Sec-CH-UA-Mobile': headers?.['sec-ch-ua-mobile'],
        'Sec-CH-UA-Platform': headers?.['sec-ch-ua-platform'],
        'Sec-CH-UA-Platform-Version': headers?.['sec-ch-ua-platform-version'],
        'Upgrade-Insecure-Requests': '1'
      });
      
      // (اختياري) حقن بصمة
      const injector = new FingerprintInjector();
      await injector.attachFingerprintToPlaywright(workContext, fpWithHeaders);
      
      const page = await workContext.newPage();
      
      // 5) فحص الثقة
      const check = new CheckTrustIp();
      const isTrust = await check.launch(page);
      console.log(`[Attempt ${attempt}] [Rot ${rot}/${ROTATE_RETRIES}] isTrust=`, isTrust);
      
      if (isTrust) {
        // كمل شغلك
        const profileData = await check.getNewProfile();
        const ok = await CreateAccount(page, profileData);
        return { ok, reason: ok ? 'done' : 'create-failed' };
      }
      
      // فشل الثقة → جرّب بروكسي جديد بعد 20s
      if (rot < ROTATE_RETRIES) {
        console.log(`[Attempt ${attempt}] rotate proxy after ${ROTATE_WAIT_MS}ms...`);
        await delay(ROTATE_WAIT_MS);
      }
    }
    
    // لو فشلت كل محاولات التدوير
    return { ok: false, reason: 'trust-failed-after-rotations' };
    
  } catch (e) {
    console.error('runOnce error:', e);
    return { ok: false, reason: e?.message || 'error' };
  } finally {
    if (workContext) { try { await workContext.close(); } catch {} }
    if (browser)     { try { await browser.close(); } catch {} }
  }
}

exports.handler = async (event = {}) => {
  const MAX_ATTEMPTS = Number(event.MAX_TRUST_ATTEMPTS || process.env.MAX_TRUST_ATTEMPTS || 1);
  const COOLDOWN = Number(event.RETRY_COOLDOWN_MS || process.env.RETRY_COOLDOWN_MS || 1500);
  
  log('BOOT', 'handler start');
  
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log('RUN', `runOnce attempt=${attempt}`);
    
    const res = await runOnce(attempt);
    if (res.ok) {
      log('DONE', { attempt, result: res });
      return { ok: true, attempt, result: res };
    }
    const wait = COOLDOWN + Math.floor(Math.random() * 400);
    log('RETRY', { attempt, inMs: wait, reason: res.reason });
    await delay(wait);
  }
  log('FAIL', `Failed after ${MAX_ATTEMPTS} attempts`);
  return { ok: false, error: `Failed after ${MAX_ATTEMPTS} attempts` };
};
