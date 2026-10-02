"""Actual browser actions and downloads. Failed AI features remain BLOCKED.
Run: python scripts/verify-friends-site.py --base https://... --out qa/live
"""
import argparse, asyncio, json, re, zipfile
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://localhost:3018')
parser.add_argument('--out', default='qa/local')
parser.add_argument('--filter', default='')
args = parser.parse_args()
out = Path(args.out).resolve()
out.mkdir(parents=True, exist_ok=True)
source = Path('C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-401a8c28-fdc4-48e5-87e7-ae152ba47f20.jpg')
second = Path('C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-0ce4fee1-3213-4712-b4bd-8c8f8e3eb934.jpg')
report = {'base': args.base, 'checks': [], 'features': {}, 'page_errors': []}
forbidden = re.compile(r'登录|积分|充值|本次消耗|额度|套餐价格|会员特惠')

async def record(name, fn):
    if args.filter and not re.search(args.filter, name): return
    try:
        value = await fn()
        report['checks'].append({'name': name, 'status': 'PASS', 'details': value})
        print('PASS', name, flush=True)
    except Exception as error:
        report['checks'].append({'name': name, 'status': 'FAIL', 'details': str(error)[:500]})
        print('FAIL', name, str(error)[:180], flush=True)

async def settled(page):
    await page.wait_for_function("!document.querySelector('.studio-primary:disabled')", timeout=180000)
    await page.wait_for_timeout(250)

async def no_business(page):
    text = await page.locator('body').inner_text()
    assert not forbidden.search(text), forbidden.search(text).group(0) if forbidden.search(text) else ''

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe', headless=True)
        context = await browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        page = await context.new_page()
        page.on('pageerror', lambda error: report['page_errors'].append(str(error)))

        for route in ['/batch-matting','/studio-genesis','/aesthetic-mirror','/sku-replace','/clothing-studio','/buyer-show','/refinement-studio','/batch-translation','/canvas-studio','/video-studio','/studio-genesis/batch']:
            async def check_page(route=route):
                response = await page.goto(args.base + route, wait_until='domcontentloaded')
                assert response.status == 200
                assert page.url == args.base + route, 'unexpected redirect: '+page.url
                await page.wait_for_timeout(1800)
                await no_business(page)
                assert not await page.get_by_text('加载中…', exact=True).count(), 'stuck loading'
                return 'Page renders without login/billing; generation tested separately'
            await record('page ' + route, check_page)

        async def billing_redirects():
            for route in ['/sign-in','/pricing','/account','/invite']:
                await page.goto(args.base+route)
                assert page.url.endswith('/batch-matting'), page.url
            return 'Legacy account/billing links return to tools'
        await record('account and billing removed', billing_redirects)

        async def cutout():
            await page.goto(args.base+'/batch-matting')
            await page.locator('input[type=file]').set_input_files([str(source), str(second)])
            await page.locator('.studio-primary').click()
            await page.locator('.studio-result img').nth(1).wait_for(timeout=180000)
            await settled(page)
            assert await page.locator('.studio-result img').count() == 2
            await page.locator('.studio-result').first.hover()
            async with page.expect_download() as event:
                await page.locator('.studio-result-actions button').filter(has_text='下载').first.click()
            download = await event.value
            target = out/'cutout-white.png'
            await download.save_as(target)
            image = Image.open(target).convert('RGBA')
            assert abs(image.width/image.height - .75) < .002
            assert image.getpixel((0,0)) == (255,255,255,255)
            assert len(set(image.resize((80,80)).getdata())) > 50, 'empty image'
            async with page.expect_download() as event:
                await page.get_by_role('button', name='下载全部', exact=True).click()
            await (await event.value).save_as(out/'cutout-all.zip')
            with zipfile.ZipFile(out/'cutout-all.zip') as archive:
                assert len(archive.namelist()) == 2
                for name in archive.namelist():
                    assert archive.read(name)[:8] == b'\x89PNG\r\n\x1a\n'
            await page.locator('.studio-result-check').first.click()
            async with page.expect_download() as event:
                await page.get_by_role('button', name='下载已选 1', exact=True).click()
            await (await event.value).save_as(out/'cutout-selected.zip')
            with zipfile.ZipFile(out/'cutout-selected.zip') as archive: assert len(archive.namelist()) == 1
            await page.screenshot(path=str(out/'white-background-desktop.png'), full_page=True)
            report['features']['快速抠图'] = 'PASS: two original photos, white PNG, single download, ZIP/selected ZIP'
            return {'output': str(target), 'size': image.size, 'corners': 'pure white'}
        await record('cutout, original photos and actual downloads', cutout)

        async def transparent():
            await page.goto(args.base+'/batch-matting')
            await page.locator('input[type=file]').set_input_files(str(second))
            await page.locator('.studio-field').filter(has=page.locator('label', has_text='输出背景')).locator('select').select_option('透明背景')
            await page.locator('.studio-primary').click()
            await page.locator('.studio-result img').wait_for(timeout=180000)
            await settled(page)
            await page.locator('.studio-result').hover()
            async with page.expect_download() as event:
                await page.locator('.studio-result-actions button').filter(has_text='下载').click()
            await (await event.value).save_as(out/'cutout-transparent.png')
            image = Image.open(out/'cutout-transparent.png').convert('RGBA')
            assert image.getpixel((0,0))[3] == 0
            assert image.getchannel('A').getextrema() == (0,255)
            return 'Downloaded PNG has real transparent background'
        await record('transparent PNG', transparent)

        async def failure_flow():
            await page.goto(args.base+'/batch-matting')
            await page.locator('input[type=file]').set_input_files(str(source))
            await page.get_by_role('button', name='AI 商品重拍', exact=True).click()
            await page.locator('.studio-primary').click()
            await settled(page)
            if await page.locator('.studio-result img').count():
                report['features']['AI 商品重拍'] = 'GENERATED: requires visual quality review'
                await page.screenshot(path=str(out/'reshoot-success.png'), full_page=True)
                return 'Actual model returned an image, not a mock'
            error = await page.locator('.studio-error').inner_text()
            assert '不可用' in error or '失败' in error
            assert await page.locator('.studio-result img').count() == 0, 'original must not be a fake result'
            await no_business(page)
            report['features']['AI 商品重拍'] = 'BLOCKED: '+error.split('\n')[0]
            await page.screenshot(path=str(out/'reshoot-failure.png'), full_page=True)
            await page.get_by_role('button', name='切换快速抠图').click()
            await page.locator('.studio-primary').click()
            await page.locator('.studio-result img').wait_for(timeout=180000)
            return 'Error shown without original-as-result; explicit cutout recovery succeeds'
        await record('AI failure and explicit free recovery', failure_flow)

        for route, feature in [('/studio-genesis','全品类商品图'),('/aesthetic-mirror','风格复刻'),('/sku-replace','SKU 替换'),('/clothing-studio','服装组图'),('/buyer-show','买家秀'),('/batch-translation','图片翻译')]:
            async def generation(route=route, feature=feature):
                await page.goto(args.base+route)
                for inp in await page.locator('input[type=file]').all(): await inp.set_input_files(str(source))
                await page.locator('textarea').first.fill('保留商品包装、文字、图案和结构，不添加虚构卖点。')
                count = page.locator('.studio-field').filter(has=page.locator('label', has_text='生成数量')).locator('select')
                if await count.count(): await count.select_option(label='1 张')
                await page.locator('.studio-primary').click()
                await settled(page)
                if route == '/studio-genesis' and await page.get_by_role('button', name='按分镜生成图片').count():
                    assert await page.locator('textarea').count() >= 2
                    await page.get_by_role('button', name='按分镜生成图片').click()
                    await settled(page)
                await no_business(page)
                if await page.locator('.studio-result img').count():
                    report['features'][feature] = 'GENERATED: needs content and quality review'
                else:
                    error = await page.locator('.studio-error').inner_text()
                    report['features'][feature] = 'BLOCKED: '+error
                    assert '登录' not in error and '积分' not in error
                return report['features'][feature]
            await record('actual submission '+feature, generation)

        async def refinement():
            await page.goto(args.base+'/refinement-studio')
            await page.locator('input[type=file]').set_input_files(str(second))
            await page.locator('.studio-primary').click()
            await page.locator('.studio-result img').wait_for(timeout=180000)
            await settled(page)
            report['features']['图片精修：白底'] = 'PASS: actual browser output'
            for label in ['高清放大','服装去皱','去水印']:
                await page.locator('select').filter(has=page.locator('option', has_text=label)).select_option(label=label)
                await page.locator('.studio-primary').click()
                await settled(page)
                await no_business(page)
                if await page.locator('.studio-result img').count(): report['features']['图片精修：'+label] = 'GENERATED: review required'
                else: report['features']['图片精修：'+label] = 'BLOCKED: '+await page.locator('.studio-error').inner_text()
            return 'White background works; upscale/AI edit availability separately recorded'
        await record('refinement operations', refinement)

        async def canvas():
            await page.goto(args.base+'/canvas-studio')
            await page.get_by_role('button', name=re.compile('开始创作')).wait_for(timeout=20000)
            await page.get_by_role('button', name=re.compile('开始创作')).click()
            await page.get_by_test_id('canvas-root-upload').set_input_files(str(second))
            await page.locator('.react-flow__node').first.wait_for(timeout=30000)
            await page.reload()
            await page.locator('.react-flow__node').first.wait_for(timeout=30000)
            download_button = page.get_by_title('下载本项目', exact=True)
            async with page.expect_download() as event:
                await download_button.click()
            await (await event.value).save_as(out/'canvas-project.zip')
            with zipfile.ZipFile(out/'canvas-project.zip') as archive: assert len(archive.namelist()) == 1
            await no_business(page)
            await page.screenshot(path=str(out/'canvas-persisted.png'), full_page=True)
            report['features']['万能画布'] = 'PASS: no login, real upload node, persists after reload, downloaded project ZIP'
            return 'Uploaded node saved to private anonymous workspace'
        await record('canvas upload and persistence', canvas)

        async def isolation():
            session = await context.request.get(args.base+'/api/workspace-session')
            owner = (await session.json())['user']['email']
            outsider = await browser.new_context()
            denied = await outsider.request.get(args.base+'/api/account?email='+owner)
            assert denied.status == 403
            admin = await context.request.get(args.base+'/api/admin/settings')
            assert admin.status in (401,403)
            await outsider.close()
            return 'Another browser cannot read private workspace; guest cannot enter admin'
        await record('anonymous workspace isolation', isolation)

        async def video():
            await page.goto(args.base+'/video-studio')
            await page.locator('textarea').first.fill('唐山特产礼盒，展示真实包装。')
            helper = page.get_by_role('button', name=re.compile('生成脚本|生成分镜|帮写脚本|一键帮写'))
            if await helper.count(): await helper.first.click()
            else: await page.locator('textarea').last.fill('展示真实商品包装和细节。')
            await page.get_by_role('button', name='保存草稿', exact=True).click()
            saved = await page.evaluate("JSON.parse(localStorage.getItem('novaryns-video-studio-drafts-v1') || '[]')")
            assert len(saved) == 1 and saved[0]['script'].strip()
            await page.reload()
            await page.get_by_text(saved[0]['title'], exact=True).wait_for()
            await no_business(page)
            report['features']['电商视频：脚本草稿'] = 'PASS: editable script saved'
            status = await context.request.get(args.base+'/api/tool-status')
            report['features']['电商视频：生成'] = 'BLOCKED: no video service configured' if not (await status.json())['video'] else 'NOT TESTED'
            return report['features']['电商视频：生成']
        await record('video script and true service availability', video)

        async def mobile():
            await page.set_viewport_size({'width':375,'height':812})
            for route in ['/batch-matting','/aesthetic-mirror','/video-studio']:
                await page.goto(args.base+route)
                await page.wait_for_timeout(700)
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'horizontal overflow '+route
                await no_business(page)
            await page.goto(args.base+'/batch-matting')
            await page.get_by_role('button', name='打开导航', exact=True).click()
            await page.get_by_role('navigation', name='移动端创作工具').wait_for()
            await no_business(page)
            await page.screenshot(path=str(out/'mobile-navigation.png'), full_page=True)
            return '375px layout and navigation work without billing links'
        await record('mobile layout and navigation', mobile)
        await browser.close()
    (out/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print('RESULT', str(out/'report.json'), flush=True)

asyncio.run(main())
