const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  const devices = [
    { name: 'iPhone SE', width: 375, height: 667 },
    { name: 'iPhone 14', width: 390, height: 844 },
    { name: 'Pixel 7', width: 412, height: 915 },
    { name: 'iPad', width: 768, height: 1024 },
    { name: 'Desktop', width: 1440, height: 900 }
  ];

  for (const device of devices) {
    console.log(`Testing on ${device.name}...`);
    await page.setViewport({ width: device.width, height: device.height });
    
    // Test Dashboard
    await page.goto('http://localhost:3000');
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: `screenshot_${device.name.replace(' ', '_')}_dashboard.png` });

    const hostBtn = await page.$('button.btn-primary');
    if (hostBtn) {
      await hostBtn.click();
      await new Promise(r => setTimeout(r, 1000));
      await page.screenshot({ path: `screenshot_${device.name.replace(' ', '_')}_activeview.png` });
    }
  }

  await browser.close();
  console.log('Done!');
})();
