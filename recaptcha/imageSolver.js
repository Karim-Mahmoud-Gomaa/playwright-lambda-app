// services/captchaSolver.js

const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.RECAPTCHA_KEY; // cap.guru API Key
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function screenshotIframeBase64Simple(page, iframe, { type = 'png', asDataUrl = false } = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await iframe.evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; });

  const buf = await iframe.screenshot({ type }); 
  const b64 = buf.toString('base64');
  return asDataUrl ? `data:image/${type};base64,${b64}` : b64;
}

function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
async function clickVerifyButton(page, highlightClicks = false) {
    try {
        const frameHandle = await page.waitForSelector('iframe[src*="/bframe"]');
        const frame = await frameHandle.contentFrame();
        // this.clickButtonByTextVariants(frame, ['Verify','Next','Confirm','Continue','OK','Finish','Submit','Skip'], 'button');
        const verifyButton = await frame.$('#recaptcha-verify-button');
        
        if (verifyButton) {
            const box = await verifyButton.boundingBox();
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.down();
                await delay(Math.floor(Math.random() * 100) + 500);
                await page.mouse.up();
                console.log('Clicked Verify with mouse events.');
            } else {
                console.log('Bounding box not found for verify button');
            }
            // await verifyButton.click();
            // console.log(verifyButton);
            // console.log('Clicked Verify.');
            // await delay(Math.floor(Math.random() * 100) + 100);
        }else{
            console.log('Verify button not found.');
        }
    } catch (error) {
        console.log("clickVerifyButton error ...");
    }
    return;
    // جميع احتمالات iframe الخاصة بـ bframe
    const frameSelectors = [
        // 'iframe[src*="/recaptcha/enterprise/bframe"]',
        'iframe[src*="/bframe"]',
        // 'iframe[src*="/recaptcha/bframe"]',
    ];
    
    let frameHandle = null;
    
    for (const selector of frameSelectors) {
        try {
            frameHandle = await page.waitForSelector(selector, { timeout: 5000 });
            if (frameHandle) break;
        } catch (_) {}
    } 
    
    if (!frameHandle) {
        console.log('[⚠️] No reCAPTCHA bframe found.');
        return;
    }
    
    const boundingBox = await frameHandle.boundingBox();
    if (!boundingBox) {
        console.log('[⚠️] No boundingBox found for the bframe.');
        return;
    }
    
    const x = boundingBox.x + 340 + getRandomNumber(1, 35);
    const y = boundingBox.y + 540 + getRandomNumber(1, 5);
    
    // console.log(`🖱️ Click on coordinates x:${x}, y:${y}`);
    console.log('✅ Click Verify/Skip');
    
    // تنفيذ النقرة
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 20) + 10 });
    await delay(300 + Math.random() * 300);
    await page.mouse.down();
    await delay(100 + Math.random() * 200);
    await page.mouse.up();
    await delay(500 + Math.random() * 1000);
    
    // عرض التأثير البصري للنقرة إذا طُلب
    if (highlightClicks) {
        let clickCoordinatesToShow = { x: x, y: y };
        await page.evaluate(({ click, showClickInfoFunc }) => {
            eval(showClickInfoFunc);
            showClickInfo(click.x, click.y);
        }, {
            click: clickCoordinatesToShow,
            showClickInfoFunc: showClickInfo.toString()
        });
    }
}
async function clickCoordinates(page,iframe,solution) {
    
    const iframeBoundingBox = await iframe.boundingBox();
    const coordinates = solution.replace('coordinates:', '').split(';').map(pair => {
        const [x, y] = pair.split(',').map(p => parseInt(p.split('=')[1], 10));
        return { x, y };
    });
    
    for (const coord of coordinates) {
        const targetX = coord.x + iframeBoundingBox.x;
        const targetY = coord.y + iframeBoundingBox.y;
        
        const randomX = targetX + Math.floor(Math.random() * 5) - 2;
        const randomY = targetY + Math.floor(Math.random() * 5) - 2;
        
        await page.mouse.move(randomX, randomY, { steps: Math.floor(Math.random() * 20) + 10 });
        
        await delay(300 + Math.random() * 300);
        
        await page.mouse.down();
        await delay(100 + Math.random() * 200);
        await page.mouse.up();
        
        await delay(500 + Math.random() * 1000);
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
    
}

// إرسال الصورة إلى cap.guru
async function uploadCaptcha(base64Image, instruction = 'click all images with cars') {
    const response = await axios.post('https://api.cap.guru/in.php', {
        key: API_KEY,
        method: 'base64',
        textinstructions: instruction.toLowerCase(),
        click: 'recap',
        body: base64Image,
        json: 1
    });
    
    if (response.data.status !== 1) {
        throw new Error(`❌ Error uploading captcha: ${response.data.request}`);
    }
    
    return response.data.request;
}

async function getInstructionText(frame) {
    const el = await frame.$('.rc-imageselect-desc-no-canonical strong') || await frame.$('.rc-imageselect-desc strong');
    return el ? frame.evaluate(el => el.innerText, el) : null;
}

async function waitForSolution(captchaId, maxTries = 4, interval = 5000) {
    for (let i = 0; i < maxTries; i++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        
        const res = await axios.get('https://api.cap.guru/res.php', {
            params: {
                key: API_KEY,
                action: 'get',
                id: captchaId,
                json: 1
            }
        });
        
        if (res.data.request === 'notpic') {
            return null;
        }
        
        if (res.data.status === 1) {
            return res.data.request;
        }
        
    }
    
    throw new Error('❌ Timeout waiting for captcha solution.');
}

// الدالة العامة القابلة لإعادة الاستخدام
async function solveCaptcha(page,iframe,name) {
    const frame = await iframe.contentFrame();
    const instruction = await getInstructionText(frame);
    console.log('instruction:', instruction);
    const base64 = await screenshotIframeBase64Simple(page,iframe);
    console.log('take screenshot');
    const captchaId = await uploadCaptcha(base64, instruction);
    console.log('captchaId:', captchaId);
    const solution = await waitForSolution(captchaId);
    console.log('solution:', solution);
    if (solution) {
        const contentFrame = await iframe.contentFrame();
        const imagesBefore = await contentFrame.$$eval('.rc-image-tile-wrapper img', imgs => imgs.map(img => img.src));
        await clickCoordinates(page,iframe,solution);
        const imagesAfter = await contentFrame.$$eval('.rc-image-tile-wrapper img', imgs => imgs.map(img => img.src));
        const sameImages = JSON.stringify(imagesBefore) === JSON.stringify(imagesAfter);
        console.log('sameImages length:'+sameImages.length);
        if (!sameImages) {
            console.log('solve captcha again...');
            return await solveCaptcha(page,iframe,name);
        }
    }
    console.log('click verify button...'); 
    await clickVerifyButton(page);
    return true;
}

module.exports = { solveCaptcha };
