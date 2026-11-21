// Render the authored deck in a fresh, offline browser context; stdout is the image list.
const fs = require("node:fs");
const path = require("node:path");

function loadChromium() {
  try {
    return require("playwright").chromium;
  } catch {
    const bundled = path.join(path.dirname(process.execPath), "..", "node_modules", "playwright");
    return require(bundled).chromium;
  }
}

async function render() {
  const html = fs.readFileSync(0, "utf8");
  const chromium = loadChromium();
  let browser;
  try {
    browser = await chromium.launch({channel: "chrome"});
  } catch (chromeError) {
    try {
      browser = await chromium.launch();
    } catch (chromiumError) {
      throw new Error("Could not start a browser for offline slide previews.\n" +
        "Local Chrome: " + chromeError.message + "\nPlaywright Chromium: " + chromiumError.message);
    }
  }
  try {
    const context = await browser.newContext({
      viewport: {width: 1280, height: 720}, deviceScaleFactor: 0.25,
      offline: true, serviceWorkers: "block", reducedMotion: "reduce", colorScheme: "light",
    });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    // Apply the same inline-only resource boundary as the encrypted viewer.
    const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'";
    const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
    await page.setContent(html.replace(/<head>/i, head => head + meta), {waitUntil: "load"});
    await page.evaluate(() => document.querySelector('#toggle-previews[aria-expanded="true"]')?.click());
    await page.addStyleTag({content: `
      #slide-previews, #preview-backdrop, .deck-tools, #meeting-notes { display: none !important; }
      body.presenting #slides { position: fixed; inset: 0; width: 100vw; height: 100vh; overflow: hidden; }
      *, *::before, *::after { animation: none !important; transition: none !important; }
    `});
    const slides = page.locator("#slides > section.slide");
    const count = await slides.count();
    if (!count) throw new Error("No top-level slides found.");
    const previews = [];
    for (let i = 0; i < count; i++) {
      if (i) await page.locator("#next").evaluate(button => button.click());
      const slide = slides.nth(i);
      await slide.waitFor({state: "visible"});
      await slide.evaluate(async section => {
        for (const video of section.querySelectorAll("video")) {
          video.pause();
          if (video.readyState >= 1) video.currentTime = 0;
        }
        for (const svg of section.querySelectorAll("svg")) {
          svg.pauseAnimations();
          svg.setCurrentTime(0);
        }
        await Promise.all(Array.from(section.querySelectorAll("img"), image => {
          image.loading = "eager";
          return image.decode();
        }));
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(resolve));
      });
      const jpeg = await page.screenshot({type: "jpeg", quality: 84});
      previews.push("data:image/jpeg;base64," + jpeg.toString("base64"));
    }
    process.stdout.write(JSON.stringify(previews));
  } finally {
    await browser.close();
  }
}

render().catch(error => {
  console.error("Offline slide renderer:", error.message);
  process.exitCode = 1;
});
