FROM public.ecr.aws/lambda/nodejs:22

ENV NODE_ENV=production
WORKDIR /var/task

# تبعيات Chromium/Playwright على Amazon Linux 2023
RUN dnf -y update && dnf -y install \
    at-spi2-core atk cups-libs dbus-libs \
    libX11 libXcomposite libXdamage libXext libXi libXrandr libXrender libXtst \
    libXcursor libXfixes \
    pango cairo gtk3 glib2 libxkbcommon \
    libdrm mesa-libgbm mesa-libEGL \
    nss nspr alsa-lib \
    xorg-x11-fonts-Type1 xorg-x11-fonts-misc liberation-fonts \
    ca-certificates tzdata \
    which wget unzip \
  && dnf clean all

# تثبيت باكدجات المشروع (بدون devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev

# تنزيل Chromium فقط (لا نستخدم --with-deps هنا)
RUN npx playwright install chromium

# نسخ بقية الكود
COPY . .

# Lambda base image فيها RIC مدمج؛ فقط عرّف اسم الهاندلر
CMD ["index.handler"]
