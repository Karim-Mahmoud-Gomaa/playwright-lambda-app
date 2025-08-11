const { clickRecaptchaVerifyButton } = require("../utils/clickRecaptchaVerifyButton");
const { solveCaptcha } = require('../recaptcha/imageSolver');

const axios = require('axios');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function logCurrentLine(label = '') {
    const stack = new Error().stack.split('\n');
    console.log(`🧭 ${label} → ${stack[2].trim()}`);
}

class RecaptchaSolver {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async solve(pageOrFrame,times = 0) {
        logCurrentLine('Starting to solve reCAPTCHA...'+times);
        await pageOrFrame.waitForSelector('iframe[src*="recaptcha"]', { timeout: 30000 });
        const iframeElement = await pageOrFrame.$('iframe[src*="recaptcha"]');
        const iframe = await iframeElement.contentFrame();
        if (await this.RecaptchaSolved(iframe)) {return true;}
        logCurrentLine('iframe loaded...');
        
        const expiredMessage = await iframe.locator('text=Verification challenge expired. Check the checkbox again.');
        let hasError = await expiredMessage.isVisible();
        if (hasError) {
            console.log('Verification challenge expired.');
        }
        // if (times>0) {
        //     hasError = await this.findText(iframe, 'Check the checkbox again', 'span', 3000);
        //     console.log('hasError:',hasError);
        // }
        
        if (times==0||hasError) {
            // if (times==0) {
            await iframe.waitForSelector('.recaptcha-checkbox');
            // await delay(Math.floor(Math.random() * 1000) + 2000); 
            await iframe.click('.recaptcha-checkbox');
            await delay(Math.floor(Math.random() * 1000) + 2000); 
            const checkboxClass = await iframe.$('.recaptcha-checkbox-checked');
            if (checkboxClass) { return true; }
        }
        //////////////////////////////////////////
        let frame2Handle = null;
        try {
            frame2Handle = await pageOrFrame.waitForSelector('iframe[src*="api2/bframe"]', { timeout: 60000 });
        } catch (error) {
            return true;
        }
        await delay(Math.floor(Math.random() * 1000) + 2000);
        const result = await solveCaptcha(pageOrFrame,frame2Handle);
        const iframeElement3 = await pageOrFrame.$('iframe[src*="recaptcha"]');
        console.log('iframeElement3 Is:',iframeElement3?true:false);
        if (iframeElement3) {
            const iframe3 = await iframeElement3.contentFrame();
            const recaptchaSolved = await this.RecaptchaSolved(iframe3);
            if (!recaptchaSolved) {
                if (times>3) {return false;}
                console.log('New reCAPTCHA...');
                return await this.solve(pageOrFrame,times+1);
            }
            console.log('reCAPTCHA solved!');
        }
        return true;
    }
    
    async RecaptchaSolved(frame) {
        try {
            await frame.waitForSelector('#recaptcha-anchor', { timeout: 4000 });
            await frame.waitForSelector('.recaptcha-checkbox-checked', { timeout: 2000 });
            console.log('reCAPTCHA solved!111');
            return true;
        } catch (error) {
            console.log('reCAPTCHA not solved...xxx');
            return false;
        }
    }
    async getInstructionText(frame) {
        const el = await frame.$('.rc-imageselect-desc-no-canonical strong');
        if (!el) {
            const el2 = await frame.$('.rc-imageselect-desc strong');
            if (!el2) return null;
            return await frame.evaluate(el => el.innerText, el2);
        };
        return await frame.evaluate(el => el.innerText, el);
    }
    
    async uploadCaptcha(base64, instruction) {
        // console.log(base64);
        
        const response = await axios.post('https://api.cap.guru/in.php', {
            key: this.apiKey,
            method: 'base64',
            textinstructions: instruction.toLowerCase(), 
            click: 'recap',
            body: base64, 
            json: 1
        });
        logCurrentLine('uploadCaptcha');
        // console.log(response.data);
        
        if (response.data.status !== 1) {
            throw new Error('Error uploading captcha: ' + response.data.request);
        }
        
        return response.data.request;
    }
    
    async waitForSolution(captchaId) {
        for (let i = 0; i < 24; i++) {
            try {
                logCurrentLine('waitForSolution:'+i);
                await new Promise(resolve => setTimeout(resolve, 5000));
                const res = await axios.get('https://api.cap.guru/res.php', {params: {key:this.apiKey, action:'get', id:captchaId, json: 1} });
                
                // console.log(res.data);
                if (res.data.request == 'notpic') {
                    return null
                }else if (res.data.status === 1) {
                    return res.data.request;
                } 
                
            } catch (error) {
                console.log(error.message);
            }
        }
        console.log('Timeout waiting for captcha solution');
        return {status: 1,request: 'notpic'}
    }
    
    
    async clickCoordinates(frame, solution, iframeBoundingBox) {
        const coordinates = solution.replace('coordinates:', '').split(';').map(pair => {
            const [x, y] = pair.split(',').map(p => parseInt(p.split('=')[1], 10));
            return { x, y };
        });
        
        for (const coord of coordinates) {
            const targetX = coord.x + iframeBoundingBox.x;
            const targetY = coord.y + iframeBoundingBox.y;
            
            // await frame.mouse.move(targetX, targetY, { steps: 15 });
            const randomX = targetX + Math.floor(Math.random() * 5) - 2;
            const randomY = targetY + Math.floor(Math.random() * 5) - 2;
            
            await frame.mouse.move(randomX, randomY, { steps: Math.floor(Math.random() * 20) + 10 });
            
            await delay(300 + Math.random() * 300);
            
            await frame.mouse.down();
            await delay(100 + Math.random() * 200);
            await frame.mouse.up();
            
            await delay(500 + Math.random() * 1000);
        }
    }
    
    async clickVerifyButton(page) {
        console.log('clicking verify...');
        await clickRecaptchaVerifyButton(page);
        // await delay(Math.floor(Math.random() * 1000) + 1000);
        // try {
        //     const frameHandle = await page.waitForSelector('iframe[src*="api2/bframe"]');
        //     const frame = await frameHandle.contentFrame();
        //     // this.clickButtonByTextVariants(frame, ['Verify','Next','Confirm','Continue','OK','Finish','Submit','Skip'], 'button');
        //     const verifyButton = await frame.$('#recaptcha-verify-button');
        
        //     if (verifyButton) {
        //         await verifyButton.click();
        //         console.log(verifyButton);
        //         console.log('Clicked Verify.');
        //         await delay(Math.floor(Math.random() * 1000) + 2000);
        //     }else{
        //         console.log('Verify button not found.');
        //     }
        // } catch (error) {
        //     console.log("clickVerifyButton error ...");
        // }
    }
    
    async getImageSources(frame) {
        return await frame.$$eval('.rc-image-tile-wrapper img', imgs => imgs.map(img => img.src));
    }
    
    async checkIfChallengeActive(frame) {
        const instruction = await frame.$('.rc-imageselect-desc-no-canonical');
        const verifyBtn = await frame.$('#recaptcha-verify-button');
        
        if (!instruction && verifyBtn) {
            return false;
        }
        return true;
    }
    
    async findText(page, text, selector = null, timeout = 3000) {
        try {
            if (selector) {
                return await page.waitForFunction((selector, text) => {
                    return [...document.querySelectorAll(selector)].some(el => el.innerText.includes(text));
                }, { timeout }, selector, text);
            } else {
                return await page.waitForFunction(text => {
                    return document.body && document.body.innerText.includes(text);
                }, { timeout }, text);
            }
        } catch {
            return false;
        }
    }
    
    async clickButtonByTextVariants(page, texts = [], tag = 'button') {
        console.log('clickButtonByTextVariants....');
        
        await page.evaluate((texts, tag) => {
            const elements = Array.from(document.querySelectorAll(tag));
            console.log(elements.length);
            elements
            .filter(el => texts.some(txt => el.innerText.includes(txt)) && !el.disabled)
            .forEach(el => el.click());
        }, texts, tag);
    }
}

module.exports = RecaptchaSolver;
