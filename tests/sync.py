import sys, re, json
from playwright.sync_api import sync_playwright
URL, V10, ENC11, KEY = sys.argv[1:5]
body = open(ENC11, 'rb').read()
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 780})
    ctx.route(re.compile(r'.*/datos\.enc.*'), lambda r: r.fulfill(status=200, body=body, content_type='application/json'))
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(600)
    pg.click('.tabbar button[data-tab="ajustes"]'); pg.set_input_files('#fileImport', V10); pg.wait_for_timeout(500)
    st = pg.evaluate("JSON.parse(localStorage.getItem('optcompras')||localStorage.getItem(Object.keys(localStorage).find(k=>k!=='optcompras-ui')))")
    print('antes: proveedores', len(st['vendors']), '| fecha', st['dataDate'])
    # proveedor añadido por el usuario
    pg.click('.tabbar button[data-tab="proveedores"]'); pg.once('dialog', lambda d: d.accept('Mi proveedor local')); pg.click('#addVendor'); pg.wait_for_timeout(400)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    st = pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k!=='optcompras-ui')))")
    mine = [v for v in st['vendors'] if v.get('user')]
    print('proveedor del usuario:', [(v['id'], v['name']) for v in mine])
    pg.click('.tabbar button[data-tab="ajustes"]'); pg.fill('#syncKey', KEY); pg.click('#btnSyncSave'); pg.wait_for_timeout(3000)
    print('syncInfo:', pg.inner_text('#syncInfo'))
    st = pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k!=='optcompras-ui')))")
    names = [v['name'] for v in st['vendors']]
    print('después: proveedores', len(names), '| fecha', st['dataDate'])
    print('quedan IndiaMART/sp/jintropin:', [n for n in names if 'IndiaMART' in n or 'Supplier Peptide' in n or 'Jintropin' in n])
    print('usuario conservado:', [v['id'] for v in st['vendors'] if v.get('user')])
    print('ofertas de proveedores inexistentes:', [o['id'] for o in st['offers'] if not any(v['id']==o['vendorId'] for v in st['vendors'])])
    pg.click('.tabbar button[data-tab="plan"]'); pg.wait_for_timeout(900)
    print('plan:', pg.inner_text('.total'))
    print('avisos:', pg.locator('#results .tags').first.inner_text().replace('\n',' | '))
    print('nota:', pg.inner_text('#updateNote')[:400].replace('\n',' | '))
    pg.click('.tabbar button[data-tab="proveedores"]'); pg.wait_for_timeout(300)
    print('tarjetas proveedores:', pg.locator('#vendorList > *').count())
    pg.reload(); pg.wait_for_timeout(2500)
    st = pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k!=='optcompras-ui')))")
    print('tras recargar: proveedores', len(st['vendors']))
    print('errores JS:', errs)
    b.close()
