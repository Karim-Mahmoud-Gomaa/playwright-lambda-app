FROM public.ecr.aws/lambda/nodejs:22

ENV NODE_ENV=production
# خزن المتصفحات داخل الصورة (مسار ثابت)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# امنع أي تنزيل أثناء التشغيل
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /var/task

# اعتماديّات النظام اللازمة لـ Chromium على Amazon Linux 2023
RUN dnf -y update && dnf -y install \
    at-spi2-core atk cairo cups-libs dbus-libs dbus-glib \
    libX11 libXcomposite libXcursor libXdamage libXext libXi libXrandr libXrender libXtst \
    libXfixes libxcb libxkbcommon libX11-xcb libdrm \
    mesa-libgbm mesa-libEGL \
    nss nspr \
    pango gdk-pixbuf2 glib2 \
    alsa-lib \
    xorg-x11-fonts-Type1 xorg-x11-fonts-misc liberation-fonts \
    fontconfig freetype \
    libstdc++ libgcc \
    libxshmfence \
    ca-certificates tzdata which tar xz unzip \
    glibc-langpack-en \
 && dnf clean all

# لو playwright في devDependencies حوّله إلى dependencies أو اشيل --omit=dev
COPY package*.json ./
RUN npm ci

# نزّل Chromium فقط (بدون --with-deps) داخل /ms-playwright
RUN npx --yes playwright install chromium

# باقي الكود
COPY . .

# اسم الهاندلر
CMD ["index.handler"]
