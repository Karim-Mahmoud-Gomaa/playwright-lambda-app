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
    await axios.post(process.env.SERVER_URL + '/api/save_accounts', { ...data, type_id: 1 }).then(({ data }) => {
        if (data.success) return true;
    }).catch(error => console.error('Error:', error));
    return false;
}

async function findText(page, text, selector = null, timeout = 3000) {
    try {
        const lowerText = text.toLowerCase();
        
        if (selector && typeof selector === 'string') {
            console.log('✅ Using selector:', selector);
            
            return await page.waitForFunction(
                (txt, sel) => {
                    return Array.from(document.querySelectorAll(sel))
                    .some(el => el.innerText.toLowerCase().includes(txt));
                },
                { timeout },
                lowerText,
                selector 
            );
        } else {
            console.log('✅ Searching full body ('+text+')');
            return await page.waitForFunction(
                (txt) => {
                    return document.body && document.body.innerText.toLowerCase().includes(txt);
                },
                { timeout },
                lowerText
            );
        }
    } catch (e) {
        console.error('❌ findText ('+text+') error:', e.message);
        return false;
    }
}

async function getCode(email) {
    let email_code = null;
    const endpoint = process.env.SERVER_URL+'/api/get_code';
    await axios.post(endpoint, { email }).then(response => {
        email_code = response.data.code;
        console.log(response.data);
    }).catch(error => console.error('Error:', error));
    return email_code;
}

async function runOnce(attempt) {
    let browser;
    try {
        const targetUrl = process.env.TARGET_URL || 'https://bot.sannysoft.com/';
        
        // 1) جيب بروكسي جديد (كل محاولة)
        const { proxy, arg } = await getGoodProxy({ maxAttempts: 5, cooldownMs: 1200 });
        console.log(proxy);
        
        // 2) بصمة متناسقة
        const gen = new FingerprintGenerator({
            browsers: ['chrome'],
            devices: ['desktop'],
            operatingSystems: ['windows'],
            locales: [US_DEFAULT.locale]
        });
        const fpWithHeaders = gen.getFingerprint({ locales: [US_DEFAULT.locale, 'en'] });
        const { fingerprint, headers } = fpWithHeaders;
        
        // 3) شغّل المتصفح مع البروكسي
        const launchArgs = [
            '--no-first-run', '--no-default-browser-check',
            '--lang=en-US', '--start-maximized',
            arg
        ];
        
        browser = await chromium.launch({
            headless: false, // لو Lambda خلّيه true
            args: launchArgs,
            proxy
        });
        
        // 4) اكتشاف التايمزون/الموقع عبر البروكسي
        let loc = { ...US_DEFAULT };
        const detection = await detectViaProxy(browser).catch(() => null);
        if (detection) {
            loc.timezoneId = detection.timezoneId || loc.timezoneId;
            loc.geo = detection.geo || loc.geo;
            console.log(`[Attempt ${attempt}] IP via proxy`, detection);
        } else {
            console.log(`[Attempt ${attempt}] Failed to detect IP metadata`);
        }
        
        // 5) جهّز الكونتكست + الهيدر+ حقن البصمة
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
        
        // لو حاب تروح أولًا لصفحة معينة قبل الفحص:
        // await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
        
        // 6) فحص الثقة
        await delay(1500);
        const check = new CheckTrustIp();
        const isTrust = await check.launch(page);
        
        if (!isTrust) {
            console.log(`[Attempt ${attempt}] isTrust=false → retry with new proxy`);
            await browser.close();
            return false; // فشل → نعيد المحاولة
        }
        
        console.log(`[Attempt ${attempt}] isTrust=true → success`);
        // مثال: إبقَ مفتوح 5 ثواني للمراجعة اليدوية
        
        const profileData = await check.getNewProfile();
        const ok = await CreateAccount(page,profileData);
        if (!ok) {
            await browser.close();
            return false
        };
        
        return true; // نجاح
    } catch (err) {
        console.error(`[Attempt ${attempt}] Error:`, err?.message || err);
        return false; // فشل → نعيد المحاولة
    } finally {
        if (browser) {
            try { await browser.close(); } catch {}
        }
    }
}

async function CreateAccount(page,profileData) {
    const { name, email, password } = profileData;
    console.log('profileData : ', profileData);
    // try {
    await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await delay(5000);
     //Captcha Solver
    const solver = new RecaptchaSolver(process.env.RECAPTCHA_KEY);
    const solved = await solver.solve(page)
    console.log('solved => ', solved);
    if (!solved) { return false;  }
    console.log('Recaptcha Solved............');
    await delay(5000);


    
    return true; 
    // } catch (err) {
    //     console.error('Error !:', err?.message || err);
    //     return false; 
    // } 
}

(async () => {
    const MAX_ATTEMPTS = Number(process.env.MAX_TRUST_ATTEMPTS || 5);
    const BASE_COOLDOWN = Number(process.env.RETRY_COOLDOWN_MS || 1500);
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const ok = await runOnce(attempt);
        if (ok) {
            console.log(`✅ Success on attempt ${attempt}`);
            process.exit(0);
        }
        // backoff بسيط + jitter
        const wait = BASE_COOLDOWN + Math.floor(Math.random() * 400);
        console.log(`🔁 Retry in ${wait}ms ...`);
        await delay(wait);
    }
    
    console.error(`❌ Failed after (${MAX_ATTEMPTS}) attempts`);
    process.exit(1);
})();
