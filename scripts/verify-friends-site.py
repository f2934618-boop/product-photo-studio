"""Actual browser actions and downloads. Failed AI features remain BLOCKED.
Run: python scripts/verify-friends-site.py --base https://... --out qa/live
"""
import argparse, asyncio, io, json, re, time, zipfile
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
report = {'base': args.base, 'browser': 'Playwright fallback: Browser plugin not available', 'checks': [], 'features': {}, 'page_errors': []}
forbidden = re.compile(r'登录|积分|充值|本次消耗|额度|套餐价格|会员特惠')

async def record(name, fn):
    if args.filter and not re.search(args.filter, name): return
    try:
        started = time.monotonic()
        value = await fn()
        report['checks'].append({'name': name, 'status': 'PASS', 'seconds': round(time.monotonic()-started, 2), 'details': value})
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

        status_response = await context.request.get(args.base + '/api/tool-status')
        assert status_response.status == 200
        tool_status = await status_response.json()
        report['tool_status'] = tool_status

        visible_routes = ['/batch-matting','/refinement-studio','/canvas-studio']
        disabled_routes = ['/studio-genesis','/aesthetic-mirror','/sku-replace','/clothing-studio','/buyer-show','/batch-translation','/video-studio','/studio-genesis/batch']

        for route in visible_routes:
            async def check_page(route=route):
                response = await page.goto(args.base + route, wait_until='domcontentloaded')
                assert response.status == 200
                assert page.url == args.base + route, 'unexpected redirect: '+page.url
                await page.wait_for_timeout(1800)
                await no_business(page)
                assert not await page.get_by_text('加载中…', exact=True).count(), 'stuck loading'
                return 'Visible friend tool renders without login, billing or disabled AI wording'
            await record('page ' + route, check_page)

        async def disabled_redirects():
            for route in disabled_routes:
                await page.goto(args.base+route, wait_until='domcontentloaded')
                assert page.url.endswith('/batch-matting'), route+' -> '+page.url
                await no_business(page)
            return 'Untested AI-only pages redirect to the working white-background tool'
        await record('disabled AI routes hidden', disabled_redirects)

        async def product_reshoot_gate():
            await page.goto(args.base+'/batch-matting', wait_until='domcontentloaded')
            await no_business(page)
            has_button = await page.get_by_role('button', name=re.compile('AI 商品重拍')).count()
            if not tool_status.get('generation'):
                assert has_button == 0, 'AI reshoot button is visible without a live generation backend'
                body = {
                    'image': {
                        'name': source.name,
                        'mimeType': 'image/jpeg',
                        'buffer': source.read_bytes(),
                    },
                    'ratio': '4:3',
                    'quality': 'standard',
                }
                response = await context.request.post(args.base+'/api/product-reshoot', multipart=body)
                assert response.status == 503, f'unexpected status {response.status}'
                text = await response.text()
                assert not forbidden.search(text), text[:240]
                report['features']['AI 商品重拍'] = 'BLOCKED: hidden because no live image generation backend is configured'
                return 'Generation backend unavailable: UI hides AI reshoot and API fails closed with 503'
            assert has_button > 0, 'AI reshoot button hidden although generation backend is ready'
            await page.locator('input[type=file]').set_input_files(str(source))
            await page.get_by_role('button', name=re.compile('AI 商品重拍')).click()
            await page.locator('.studio-primary').click()
            await page.locator('.studio-result img').wait_for(timeout=300000)
            await settled(page)
            await page.locator('.studio-result').first.hover()
            async with page.expect_download(timeout=120000) as event:
                await page.locator('.studio-result-actions button').filter(has_text='下载').first.click()
            target = out/'ai-product-reshoot.png'
            await (await event.value).save_as(target)
            image = Image.open(target).convert('RGBA')
            assert image.width > 256 and image.height > 256
            assert image.getpixel((0,0))[:3] == (255,255,255)
            report['features']['AI 商品重拍'] = 'PASS: generated real image and downloaded PNG'
            return {'output': str(target), 'size': image.size}
        await record('AI product reshoot availability', product_reshoot_gate)

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
            print('RUN cutout: loading model and processing two source photos', flush=True)
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

        async def ratios_and_retry():
            await page.goto(args.base+'/batch-matting', wait_until='domcontentloaded')
            buffer = io.BytesIO()
            photo = Image.open(source)
            photo.thumbnail((1000, 1000))
            photo.save(buffer, format='JPEG')
            await page.locator('input[type=file]').set_input_files({'name':'product.jpg', 'mimeType':'image/jpeg', 'buffer':buffer.getvalue()})
            ratio_select = page.locator('.studio-field').filter(has=page.locator('label', has_text='尺寸比例')).locator('select')
            dimensions = {}
            for ratio in ['1:1', '4:3', '9:16', '16:9']:
                await ratio_select.select_option(ratio)
                await page.locator('.studio-primary').click()
                await settled(page)
                assert await page.locator('.studio-result img').count() == 1
                await page.locator('.studio-result').hover()
                async with page.expect_download() as event:
                    await page.locator('.studio-result-actions button').filter(has_text='下载').click()
                target = out/('ratio-'+ratio.replace(':','-')+'.png')
                await (await event.value).save_as(target)
                image = Image.open(target)
                width, height = map(int, ratio.split(':'))
                assert abs(image.width/image.height-width/height) < .006
                dimensions[ratio] = image.size
            await page.locator('.studio-result').hover()
            await page.locator('.studio-result-actions button').filter(has_text='再生成').click()
            await settled(page)
            assert await page.locator('.studio-result img').count() == 1
            return {'dimensions':dimensions, 'regeneration':'actual processing completed'}
        await record('all additional cutout ratios and regeneration', ratios_and_retry)

        async def upload_validation():
            await page.goto(args.base+'/batch-matting', wait_until='domcontentloaded')
            await page.locator('input[type=file]').set_input_files({'name':'bad.txt', 'mimeType':'text/plain', 'buffer':b'bad'})
            assert '请选择 JPG、PNG、WebP' in await page.locator('.studio-error').inner_text()
            await page.locator('input[type=file]').set_input_files({'name':'too-big.png', 'mimeType':'image/png', 'buffer':b'x'*(12*1024*1024+1)})
            assert '不超过 12MB' in await page.locator('.studio-error').inner_text()
            assert await page.locator('.studio-primary').is_disabled()
            return 'Unsupported type and oversized file rejected before processing'
        await record('upload format and size validation', upload_validation)

        async def refinement():
            await page.goto(args.base+'/refinement-studio')
            assert await page.get_by_role('option', name='高清放大').count() == 0
            assert await page.get_by_role('option', name='服装去皱').count() == 0
            assert await page.get_by_role('option', name='去水印').count() == 0
            await page.locator('input[type=file]').set_input_files(str(second))
            await page.locator('.studio-primary').click()
            await page.locator('.studio-result img').wait_for(timeout=180000)
            await settled(page)
            report['features']['图片精修：白底'] = 'PASS: actual browser output'
            return 'White-background refinement works; unavailable AI refinement options are hidden'
        await record('refinement operations', refinement)

        async def canvas():
            await page.goto(args.base+'/canvas-studio')
            await page.get_by_role('button', name=re.compile('开始创作')).wait_for(timeout=20000)
            await page.get_by_role('button', name=re.compile('开始创作')).click()
            await page.get_by_test_id('canvas-root-upload').set_input_files(str(second))
            await page.locator('.react-flow__node').first.wait_for(timeout=30000)
            await page.reload(wait_until='domcontentloaded')
            await page.locator('.react-flow__node').first.wait_for(timeout=30000)
            download_button = page.get_by_title('下载本项目', exact=True)
            async with page.expect_download(timeout=120000) as event:
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

        async def mobile():
            await page.set_viewport_size({'width':375,'height':812})
            for route in ['/batch-matting','/refinement-studio','/canvas-studio']:
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
