import sys
from playwright.sync_api import sync_playwright
URL, DATA = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 360, 'height': 780}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.click('.tabbar button[data-tab="ajustes"]'); pg.set_input_files('#fileImport', DATA); pg.wait_for_timeout(400)
    pg.click('.tabbar button[data-tab="plan"]'); pg.wait_for_timeout(900)
    def show(label):
        card = pg.locator('#results .card').filter(has_text='Plan más barato')
        print(label, pg.inner_text('.total'), '| avisos:', card.locator('.tags').first.inner_text().replace('\n', ' | '))
        for o in card.locator('.vendor-order').all():
            h = o.locator('h3').inner_text(); tot = o.locator('header b').inner_text()
            c = o.locator('.customs')
            print('   ', h, tot, '→', (c.inner_text()[:110] + '…') if c.count() else 'UE (sin aduana)')
        sw = pg.evaluate('document.documentElement.scrollWidth')
        print('   ancho', sw, '| resumen:', pg.inner_text('#condSummary'))
    show('Solo avisar:')
    pg.click('#condCard > summary'); pg.select_option('#customsMode', 'cap'); pg.wait_for_timeout(1500)
    show('No pasar de 150 €:')
    print('   calc:', pg.inner_text('#calcInfo')[-150:])
    pg.fill('#customsLimit', '400'); pg.dispatch_event('#customsLimit', 'change'); pg.wait_for_timeout(1500)
    show('No pasar de 400 €:')
    print('errores JS:', errs)
    b.close()
