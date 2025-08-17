const { chromium } = require('playwright');

exports.handler = async (event) => {
  console.log("🔹 Lambda Playwright Test Started");

  // شغل Chromium داخل Lambda
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--disable-gpu"
    ]
  });

  const page = await browser.newPage();

  // افتح موقع ipapi
  await page.goto("https://ipapi.co/json/", { waitUntil: "domcontentloaded" });

  // استخرج محتوى الصفحة كنص
  const content = await page.textContent("pre");

  console.log("🔹 Response from ipapi.co/json:");
  console.log(content);

  await browser.close();

  return {
    statusCode: 200,
    body: content
  };
};
