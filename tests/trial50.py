import sys
from playwright.sync_api import sync_playwright
URL, DATA, OUT = sys.argv[1:4]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 360, 'height': 780}, device_scale_factor=2); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.click('.tabbar button[data-tab="ajustes"]'); pg.set_input_files('#fileImport', DATA); pg.wait_for_timeout(400)
    pg.click('.tabbar button[data-tab="productos"]'); pg.wait_for_timeout(300); pg.click('#allOff'); pg.wait_for_timeout(300)
    for pid in (11, 13, 14, 16):
        d = pg.locator(f'details.prod[data-id="{pid}"]'); d.locator('.pActive').check(); pg.wait_for_timeout(150)
        d = pg.locator(f'details.prod[data-id="{pid}"]'); d.locator('summary .name').click(); pg.wait_for_timeout(150)
        d.locator('.pSize').select_option('50'); pg.wait_for_timeout(250)
    for pid in (11, 13, 14, 16):
        print('resumen', pid, '→', pg.locator(f'details.prod[data-id="{pid}"] summary').inner_text().replace('\n', ' | '))
    pg.locator('details.prod[data-id="14"]').screenshot(path=OUT + '/fin50.png')
    pg.click('.tabbar button[data-tab="plan"]'); pg.wait_for_timeout(1200)
    card = pg.locator('#results .card').filter(has_text='Plan más barato')
    print('Total:', pg.inner_text('.total'), '| avisos:', card.locator('.tags').first.inner_text().replace('\n', ' | '))
    o = card.locator('.vendor-order').first
    print(o.locator('.lines').inner_text().replace('\n', ' | ')[:600])
    o.locator('.qBtn').click(); pg.wait_for_timeout(300)
    print('Cotización:', pg.inner_text('#msgEN').split('\n')[3:7])
    print('ancho', pg.evaluate('document.documentElement.scrollWidth'), '| errores', errs)
    b.close()
