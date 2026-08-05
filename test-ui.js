const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  const devices = [
    { name: '320px', width: 320, height: 568 },
    { name: '375px', width: 375, height: 667 },
    { name: '390px', width: 390, height: 844 },
    { name: '768px', width: 768, height: 1024 },
    { name: '1024px', width: 1024, height: 1366 }
  ];

  for (const device of devices) {
    console.log(`Testing on ${device.name}...`);
    await page.setViewport({ width: device.width, height: device.height });
    
    // 1. Test Dashboard
    await page.goto('http://localhost:3000');
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: `screenshot_${device.name}_dashboard.png` });

    // 2. Test ActiveView (Host mode)
    const hostBtn = await page.$('button.btn-primary');
    if (hostBtn) {
      await hostBtn.click();
      await new Promise(r => setTimeout(r, 1000));
      await page.screenshot({ path: `screenshot_${device.name}_activeview.png` });

      // 3. Test Stats Modal
      const infoBtn = await page.$('button.btn-icon-subtle');
      if (infoBtn) {
        await infoBtn.click();
        await new Promise(r => setTimeout(r, 500));
        await page.screenshot({ path: `screenshot_${device.name}_statsmodal.png` });
      }
    }
  }

  await browser.close();
  console.log('Done!');
})();
