import sys, re
from playwright.sync_api import sync_playwright
URL, V12, ENC13, KEY = sys.argv[1:5]
body = open(ENC13, 'rb').read()
def st(pg): return pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k!=='optcompras-ui')))")
with sync_playwright() as p:
    b = p.chromium.launch()
    for edit in (False, True):
        ctx = b.new_context(viewport={'width': 360, 'height': 780})
        ctx.route(re.compile(r'.*/datos\.enc.*'), lambda r: r.fulfill(status=200, body=body, content_type='application/json'))
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(600)
        pg.click('.tabbar button[data-tab="ajustes"]'); pg.set_input_files('#fileImport', V12); pg.wait_for_timeout(500)
        if edit:
            pg.click('.tabbar button[data-tab="productos"]'); pg.wait_for_timeout(300)
            pg.evaluate("document.querySelectorAll('#productList details').forEach(d=>d.open=true)")
            inp = pg.locator('.pTarget[data-id="22"]'); inp.fill('Mi objetivo propio'); inp.dispatch_event('change'); pg.wait_for_timeout(300)
        pg.click('.tabbar button[data-tab="ajustes"]'); pg.fill('#syncKey', KEY); pg.click('#btnSyncSave'); pg.wait_for_timeout(3000)
        s = st(pg); T = {x['id']: x['target'] for x in s['products']}
        print('editado' if edit else 'sin editar', '| fecha', s['dataDate'], '| 23:', T[23], '| 24:', T[24], '| 22:', T[22], '| errores', errs)
        ctx.close()
    b.close()
