FROM public.ecr.aws/lambda/nodejs:22

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /var/task

# اعتماديات Chromium على Amazon Linux 2023
RUN dnf -y update && dnf -y install \
    at-spi2-core at-spi2-atk \
    atk cairo pango gdk-pixbuf2 gtk3 glib2 glibc-langpack-en \
    cups-libs dbus-libs dbus-glib \
    libX11 libXcomposite libXcursor libXdamage libXext libXi libXrandr libXrender libXtst libXfixes \
    libxcb libxkbcommon libxkbcommon-x11 libX11-xcb \
    libdrm mesa-libgbm mesa-libEGL \
    nss nspr \
    alsa-lib \
    xorg-x11-fonts-Type1 xorg-x11-fonts-misc liberation-fonts fontconfig freetype \
    libstdc++ libgcc libxshmfence \
    ca-certificates tzdata which tar xz unzip \
 && dnf clean all

# ثبّت الديبندنسيز (playwright لازم يكون في dependencies)
COPY package*.json ./
RUN npm ci

# نزّل Chromium لنفس نسخة Playwright المستخدمة
# لو حبيت تجبرها، استبدل $(...) بـ "1.54.2"
RUN npx --yes playwright@$(node -p "require('./package.json').dependencies.playwright?.replace('^','') || '1.54.2'") install chromium

# انسخ الكود
COPY . .

# الهاندلر
CMD ["index.handler"]
