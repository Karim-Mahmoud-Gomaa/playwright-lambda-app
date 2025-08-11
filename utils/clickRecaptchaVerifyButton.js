const { getRandomNumber } = require("./getRandomNumber");
const { showClickInfo } = require('./showClickInfo');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Clicks the reCAPTCHA verify button on the page.
 * Compatible with both reCAPTCHA v2 and Enterprise.
 *
 * @param {Object} page - Puppeteer page object.
 * @param {boolean} [highlightClicks=false] - If true, shows visual highlight.
 */
const clickRecaptchaVerifyButton = async (page, highlightClicks = false) => {
  // جميع احتمالات iframe الخاصة بـ bframe
  const frameSelectors = [
    'iframe[src*="/recaptcha/enterprise/bframe"]',
    'iframe[src*="/recaptcha/api2/bframe"]',
    'iframe[src*="/recaptcha/bframe"]',
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

  console.log(`🖱️ Click on coordinates x:${x}, y:${y}`);
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
};

module.exports = { clickRecaptchaVerifyButton };
