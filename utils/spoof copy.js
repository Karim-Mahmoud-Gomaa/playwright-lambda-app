module.exports = async function applySpoofing(page) {
    await page.evaluateOnNewDocument(() => {
        // webdriver (native removal)
        // delete Object.getPrototypeOf(navigator).webdriver;
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        
        
        // language, platform, vendor
        Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        // Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
        // Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv8l' }); // ✅ Android platform
        Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
        
        // MimeTypes mock
        Object.defineProperty(navigator, 'mimeTypes', {
            get: () => Object.setPrototypeOf([
                { type: 'application/pdf' },
                { type: 'application/x-nacl' },
                { type: 'application/x-pnacl' }
            ], MimeTypeArray.prototype)
        });
        
        // Chrome
        window.chrome = { runtime: {} };
        
        // WebGL spoofing
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(param) {
            if (param === 37445) return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
            if (param === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
            return getParameter.call(this, param);
        };
        
        // Canvas spoofing with noise
        const getImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function(...args) {
            const imageData = getImageData.apply(this, args);
            for (let i = 0; i < imageData.data.length; i += 4) {
                imageData.data[i] += Math.floor(Math.random() * 2); // add noise to R channel
            }
            return imageData;
        };
        
        // AudioContext spoofing
        const origCreateAnalyser = AudioContext.prototype.createAnalyser;
        AudioContext.prototype.createAnalyser = function () {
            const analyser = origCreateAnalyser.call(this);
            const orig = analyser.getFloatFrequencyData;
            analyser.getFloatFrequencyData = function(array) {
                for (let i = 0; i < array.length; i++) {
                    array[i] += Math.random() * 0.01;
                }
                return orig.call(this, array);
            };
            return analyser;
        };
        
        // disable battery
        navigator.getBattery = undefined;
    });
};
