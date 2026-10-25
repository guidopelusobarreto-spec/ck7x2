import sys, re
from playwright.sync_api import sync_playwright
URL, V16, ENC, KEY = sys.argv[1:5]
body = open(ENC, 'rb').read()
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 780})
    ctx.route(re.compile(r'.*/datos\.enc.*'), lambda r: r.fulfill(status=200, body=body, content_type='application/json'))
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.click('.tabbar button[data-tab="ajustes"]'); pg.set_input_files('#fileImport', V16); pg.wait_for_timeout(400)
    pg.click('.tabbar button[data-tab="productos"]'); d = pg.locator('details.prod[data-id="16"]'); d.locator('summary .name').click(); pg.wait_for_timeout(200)
    d.locator('.pSize').select_option('100'); pg.wait_for_timeout(300)
    pg.click('.tabbar button[data-tab="ajustes"]'); pg.fill('#syncKey', KEY); pg.click('#btnSyncSave'); pg.wait_for_timeout(3000)
    st = pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k!=='optcompras-ui')))")
    print('fecha', st['dataDate'], '| tadalafilo size:', [x.get('size') for x in st['products'] if x['id']==16])
    pg.click('.tabbar button[data-tab="plan"]'); pg.wait_for_timeout(1200); print('plan', pg.inner_text('.total'), '| errores', errs)
    b.close()
