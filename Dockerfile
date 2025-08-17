FROM public.ecr.aws/lambda/nodejs:22

ENV NODE_ENV=production
# خلي Playwright يحط المتصفحات في مسار ثابت داخل الصورة
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# امنع أي تنزيل أثناء التشغيل
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /var/task

# انسخ تعريفات الحزم
COPY package*.json ./

# مهم: لو playwright داخل devDependencies هيتشال بـ --omit=dev
# انقله لـ "dependencies" أو شيل --omit=dev
RUN npm ci

# نزّل Chromium + اعتمادياته النظامية داخل الصورة
# خليك على نفس نسخة playwright المكتوبة في package.json (مثلاً 1.46.0)
RUN npx --yes playwright@$(node -p "require('./package.json').dependencies.playwright?.replace('^','') || '1.46.0'") install --with-deps chromium

# انسخ بقية الكود
COPY . .

# الهاندلر
CMD ["index.handler"]
