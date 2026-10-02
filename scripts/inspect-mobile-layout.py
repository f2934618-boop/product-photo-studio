import asyncio, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = await browser.new_page(viewport={'width':375,'height':812})
        await page.goto('http://localhost:3018/video-studio')
        await page.wait_for_timeout(1000)
        print(json.dumps(await page.evaluate("""[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:e.className,w:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,text:e.textContent.slice(0,60)})).filter(e=>e.right>innerWidth+1).slice(-12)"""),ensure_ascii=True))
        await browser.close()
asyncio.run(main())
