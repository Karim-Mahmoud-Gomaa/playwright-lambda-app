
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const axios = require('axios');
const fs = require('fs');

class CheckTrustIp {
  constructor() {}
  
  async launch(page) {
    
    // try {
    const list = this.loadTerms('terms.json');
    if (!list.length) throw new Error('No search terms provided');
    const q = this.pickRandom(list);
    
    // ابنِ الرابط بأمان
    const u = new URL('https://www.google.com/search');
    u.searchParams.set('q', q);
    u.searchParams.set('hl', 'en');
    u.searchParams.set('gl', 'us');
    u.searchParams.set('pws', String(0));
    // اختياري: نتائج أقل لتقليل الحمل
    // u.searchParams.set('num', '10');
    
    const resp = await page.goto(u.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }).catch(() => null);
    
    const status = resp?.status();
    const html = (await page.content()).toLowerCase();
    
    // إشارات تحدّي شائعة
    const challengeText =
    html.includes('captcha') ||
    html.includes('unusual traffic') ||
    html.includes('verify you are human') ||
    html.includes('sorry') ||
    status === 403 || status === 429;
    
    // هل ظهرت منطقة نتائج البحث؟
    const hasResults = !!(await page.$('#search'));
    
    const ok = Boolean(status && status < 400 && hasResults && !challengeText);
    if (status === 200) {
      await delay(2000); 
    }
    console.log('google status=', status, 'term=', q, 'challenge=', challengeText, 'hasResults=', hasResults);
    
    return true
    return ok
    
    
    // await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 120000 });
    // await page.waitForSelector('span:text("Sign in to Google")',{timeout: 60000});
    // await delay(2000); 
    
    // await page.waitForSelector('textarea[name="q"]');
    // await page.type('textarea[name="q"]', 'quora login', { delay: 120 });
    // console.log('quora login');
    
    // await delay(2000); 
    
    // await Promise.all([
    //   page.waitForNavigation({ waitUntil: 'load' }), 
    //   await page.keyboard.press('Enter'),
    // ]);
    // await delay(2000); 
    
    // const results = await page.evaluate(() => {
      //   return Array.from(document.querySelectorAll('h3')).map(el => el.innerText);
    // });
    // await delay(2000); 
    
    // return results.length?true:false;
    
    // }catch (err) {
    //   return false;
    // }
  }
  
  
  pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  
  loadTerms(source) {
    // source ممكن يكون Array جاهزة، أو مسار ملف JSON/نصي
    if (Array.isArray(source)) return source.filter(Boolean);
    if (typeof source === 'string' && fs.existsSync(source)) {
      const raw = fs.readFileSync(source, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
        // ملف نصي سطر لكل كلمة
        return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      } catch {
        // ملف نصي
        return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      }
    }
    // fallback بسيط
    return ['hello world', 'weather today', 'github', 'wikipedia'];
  }
  
  async getNewProfile() {
    try {
      const endpoint = process.env.SERVER_URL+'/api/get_new_profile';
      if (!endpoint) throw new Error('SERVER_URL is not set');
      
      const { data } = await axios.post(endpoint, {}, { timeout: 15000 });
      return data??false;
      
    }catch (err) {
      console.log(err);
      return false;
    }
  }
  
  
}

module.exports = CheckTrustIp;