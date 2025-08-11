module.exports = async function applySpoofing(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => Object.setPrototypeOf([
        { type: 'application/pdf' },
        { type: 'application/x-nacl' },
        { type: 'application/x-pnacl' }
      ], MimeTypeArray.prototype)
    });

    window.chrome = { runtime: {} };
    navigator.getBattery = undefined;
    Object.defineProperty(navigator, 'connection', {
      get: () => ({ rtt: 50, downlink: 10, effectiveType: '4g' })
    });

    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, param);
    };

    const getImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      const imageData = getImageData.apply(this, args);
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] += Math.floor(Math.random() * 2);
      }
      return imageData;
    };

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
  });
};
