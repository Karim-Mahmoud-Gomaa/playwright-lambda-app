'use strict';

require('dotenv').config();
const { chromium } = require('playwright');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');
const { getGoodProxy } = require('./proxy-utils');
const CheckTrustIp = require('./CheckTrustIp');
const RecaptchaSolver = require('./recaptcha/captchaSolver');
const axios = require('axios');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

const US_DEFAULT = {
  locale: 'en-US',
  acceptLanguage: 'en-US,en;q=0.9',
  timezoneId: 'America/New_York',
  geo: { latitude: 40.7128, longitude: -74.0060, accuracy: 50 }
};

async function detectViaProxy(browser) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('https://ipapi.co/json/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const meta = await p.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch { return null; }});
  await ctx.close();
  if (!meta) return null;
  return {
    timezoneId: meta.timezone || 'America/New_York',
    geo: (meta.latitude && meta.longitude)
      ? { latitude: meta.latitude, longitude: meta.longitude, accuracy: 50 }
      : US_DEFAULT.geo,
    ip: meta.ip, country: meta.country, region: meta.region, city: meta.city
  };
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
        (txt, sel) => Array.from(document.querySelectorAll(sel)).some(el => el.innerText.toLowerCase().includes(txt)),
        { timeout }, lowerText, selector
      );
    } else {
      return await page.waitForFunction(
        (txt) => document.body && document.body.innerText.toLowerCase().includes(txt),
        { timeout }, lowerText
      );
    }
  } catch (e) {
    console.error(`findText("${text}") error:`, e.message);
    return false;
  }
}

async function getCode(email) {
  try {
    const { data } = await axios.post(`${process.env.SERVER_URL}/api/get_code`, { email });
    return data?.code || null;
  } catch (e) {
    console.error('getCode error:', e.message);
    return null;
  }
}
 
async function CreateAccount(page, profileData) {
  const { name, email, password } = profileData;
  try {
    await page.goto('https://www.quora.com/', { waitUntil: 'domcontentloaded', timeout: 120000 });

    await delay(5000);
    const signUpBtnLoc = page.locator('text=Sign up with email');
    if (!(await signUpBtnLoc.isVisible())) return false;

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /Sign up with email/i.test(b.innerText));
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
      const btn = [...document.querySelectorAll('button')].find(b => /Next/i.test(b.innerText));
      btn?.click();
    });

    // احصل على كود البريد
    let code = await getCode(email);
    if (!code) { await delay(15000); code = await getCode(email); }
    if (!code) return false;

    await page.type('input[name="confirmationCode"]', code, { delay: 80 });
    await delay(800);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /Next/i.test(b.innerText) && !b.disabled);
      btn?.click();
    });

    await page.waitForSelector('input[name="password"]', { visible: true, timeout: 60000 });
    await page.type('input[name="password"]', password, { delay: 80 });

    // ملاحظة: تأكد أن استخدام أي محلّل CAPTCHA متوافق مع القوانين وشروط الموقع.
    const solver = new RecaptchaSolver(process.env.RECAPTCHA_KEY);
    const solved = await solver.solve(page);
    if (!solved) return false;

    await delay(1000);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => (/Finish|Next/i.test(b.innerText)) && !b.disabled);
      btns.forEach(b => b.click());
    });

    // اختيارات اهتمامات (متسامحة مع الفشل)
    try {
      await page.waitForSelector('.puppeteer_test_follow_interests_list_item', { visible: true, timeout: 30000 });
      const items = await page.$$('.puppeteer_test_follow_interests_list_item');
      for (const i of (items || []).slice(0, 6)) { await i.click(); await delay(200); }
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => (/Done|Next/i.test(b.innerText)) && !b.disabled);
        btn?.click();
      });
    } catch {}

    // لغات إضافية (إن ظهرت)
    if (await findText(page, 'What other languages do you know', null, 10000)) {
      await page.evaluate(() => {
        [...document.querySelectorAll('div')].filter(d => /Done/i.test(d.innerText)).forEach(d => d.click());
      });
    }

    await delay(5000);
    const isHome = await page.evaluate(() =>
      [...document.querySelectorAll('div')].some(d => /What do you want to ask or share\?/i.test(d.innerText))
    );

    if (isHome) {
      const scripts = await page.$$eval('script[type="text/javascript"]', els =>
        els.map(e => e.textContent).filter(txt => txt.includes('profileUrl'))
      );
      if (scripts.length) {
        const m = scripts[0].match(/push\("(.+?)"\)/);
        if (m) {
          const jsonString = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
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
  let browser;
  try {
    const { proxy, arg } = await getGoodProxy({ maxAttempts: 5, cooldownMs: 1200 });

    // بصمة
    const gen = new FingerprintGenerator({
      browsers: ['chrome'],
      devices: ['desktop'],
      operatingSystems: ['windows'],
      locales: [US_DEFAULT.locale]
    });
    const fpWithHeaders = gen.getFingerprint({ locales: [US_DEFAULT.locale, 'en'] });
    const { fingerprint, headers } = fpWithHeaders;

    // تشغيل Chromium (Lambda ⇒ headless)
    const launchArgs = [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--lang=en-US',
      arg
    ];

    browser = await chromium.launch({
      headless: true,
      args: launchArgs,
      proxy
    });

    // اكتشاف IP/Timezone عبر البروكسي
    let loc = { ...US_DEFAULT };
    const detection = await detectViaProxy(browser).catch(() => null);
    if (detection) {
      loc.timezoneId = detection.timezoneId || loc.timezoneId;
      loc.geo = detection.geo || loc.geo;
      console.log(`[Attempt ${attempt}] IP via proxy`, detection);
    }

    // سياق + هيدرز + حقن بصمة
    const context = await browser.newContext({
      userAgent: fingerprint.userAgent,
      locale: US_DEFAULT.locale,
      timezoneId: loc.timezoneId,
      viewport: fingerprint.screen,
      deviceScaleFactor: fingerprint.screen.deviceScaleFactor || 1,
      geolocation: loc.geo,
      permissions: ['geolocation']
    });

    const extra = {
      'Accept-Language': headers?.['accept-language'] || US_DEFAULT.acceptLanguage,
      'Sec-CH-UA': headers?.['sec-ch-ua'],
      'Sec-CH-UA-Mobile': headers?.['sec-ch-ua-mobile'],
      'Sec-CH-UA-Platform': headers?.['sec-ch-ua-platform'],
      'Sec-CH-UA-Platform-Version': headers?.['sec-ch-ua-platform-version'],
      'Upgrade-Insecure-Requests': '1'
    };
    Object.keys(extra).forEach(k => extra[k] === undefined && delete extra[k]);
    await context.setExtraHTTPHeaders(extra);

    const injector = new FingerprintInjector();
    await injector.attachFingerprintToPlaywright(context, fpWithHeaders);

    const page = await context.newPage();

    // فحص الثقة (من موديولك)
    await delay(1200);
    const check = new CheckTrustIp();
    const isTrust = await check.launch(page);
    if (!isTrust) {
      console.log(`[Attempt ${attempt}] isTrust=false → retry`);
      return { ok: false, reason: 'trust-failed' };
    }

    const profileData = await check.getNewProfile();
    const ok = await CreateAccount(page, profileData);
    return { ok, reason: ok ? 'done' : 'create-failed' };
  } catch (e) {
    return { ok: false, reason: e.message || 'error' };
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

exports.handler = async (event = {}) => {
  const MAX_ATTEMPTS = Number(event.MAX_TRUST_ATTEMPTS || process.env.MAX_TRUST_ATTEMPTS || 5);
  const COOLDOWN = Number(event.RETRY_COOLDOWN_MS || process.env.RETRY_COOLDOWN_MS || 1500);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log('runOnce ...');
    
    const res = await runOnce(attempt);
    if (res.ok) {
      return { ok: true, attempt, result: res };
    }
    const wait = COOLDOWN + Math.floor(Math.random() * 400);
    console.log(`retry in ${wait}ms ... (reason=${res.reason})`);
    await delay(wait);
  }
  return { ok: false, error: `Failed after ${MAX_ATTEMPTS} attempts` };
};
