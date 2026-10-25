import sys
from playwright.sync_api import sync_playwright
URL, DATA = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 360, 'height': 780})
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.click('.tabbar button[data-tab="ajustes"]'); pg.set_input_files('#fileImport', DATA); pg.wait_for_timeout(400)
    pg.click('.tabbar button[data-tab="plan"]'); pg.wait_for_timeout(800)
    def show(label):
        card = pg.locator('#results .card').filter(has_text='Plan más barato')
        print(label, pg.inner_text('.total'), '|', ' + '.join(card.locator('.vendor-order h3').all_inner_texts()))
        for o in card.locator('.vendor-order').all():
            print('   ', o.locator('h3').inner_text(), '→', ', '.join(x.split('\n')[0] for x in o.locator('.lines td:first-child').all_inner_texts() if not x.startswith(('Envío','Cupón'))))
        w = pg.locator('#results .tags').first.inner_text()
        if w.strip(): print('   avisos:', w.replace('\n', ' | '))
    show('Nivel C+:')
    pg.click('#condCard > summary'); pg.select_option('#minLevel', 'D'); pg.wait_for_timeout(900)
    show('Incluyendo D:')
    b.close()
