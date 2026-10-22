"""Pruebas en Chromium (Playwright). Los datos NO están en el repo: se pasan por variables de entorno.
Uso: DATA_FILE=datos-v5.json ENC_FILE=datos.enc CLAVE='…' python3 -I tests/e2e.py http://127.0.0.1:8766/
DATA_FILE debe ser la versión v5 (plan esperado 2.006,57 €) y ENC_FILE una versión cifrada con CLAVE."""
import os, sys, re, json
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8766/'
DATA, ENC, KEY = os.environ['DATA_FILE'], os.environ['ENC_FILE'], os.environ['CLAVE']
ENC_DATE = None
results, errors = [], []
def ok(name, cond):
    results.append((name, bool(cond))); print(('OK   ' if cond else 'FAIL ') + name)
def total(pg): return pg.inner_text('#results .total')
def tab(pg, t): pg.click(f'.tabbar button[data-tab="{t}"]'); pg.wait_for_timeout(250)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 360, 'height': 780})
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'datos.enc' not in m.text and '404' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    enc_body = {'v': open(ENC).read()}
    ctx.route(re.compile(r'.*/datos\.enc.*'), lambda r: r.fulfill(status=200, body=enc_body['v'], content_type='application/json'))
    pg.goto(URL); pg.wait_for_timeout(700)
    ok('sin datos: lo explica', 'Sin datos todavía' in pg.inner_text('#results'))

    # importar v5: el plan se calcula solo
    tab(pg, 'ajustes'); pg.set_input_files('#fileImport', DATA); pg.wait_for_timeout(600)
    tab(pg, 'plan'); pg.wait_for_timeout(600)
    ok('plan automático = 2.006,57 € (igual que la versión anterior)', total(pg).replace(' ', ' ') in ('2006,57 €', '2.006,57 €'))
    ok('resumen de condiciones', '8 paquetes' in pg.inner_text('#condSummary'))

    # condiciones: excluir transferencia y cripto recalcula sin botón
    base = total(pg)
    pg.click('#condCard > summary'); pg.select_option('#payMode', 'noTransfer'); pg.wait_for_timeout(500)
    ok('cambiar condición recalcula solo', total(pg) != base and 'PowPills' in pg.inner_text('#results'))
    pg.select_option('#payMode', 'any'); pg.wait_for_timeout(500)
    ok('volver a «cualquiera» devuelve el mismo total', total(pg) == base)

    # proveedor fijo
    pg.click('#btnFixed'); pg.wait_for_timeout(300)
    pg.locator('#sheet label', has_text='PowPills').locator('input').check(); pg.click('#fxOk'); pg.wait_for_timeout(600)
    first = pg.locator('#results .card').filter(has_text='Plan más barato')
    ok('fijar PowPills: entra en el plan marcado como «Fijo»', first.locator('.vendor-order', has_text='PowPills').locator('.tag.fix').count() == 1)
    fixed_total = total(pg)
    ok('fijar un proveedor no puede abaratar el plan', float(fixed_total.replace('.', '').replace(',', '.').split()[0].replace(' ', '')) >= float(base.replace('.', '').replace(',', '.').split()[0].replace(' ', '')))
    pg.click('#fixedChips [data-unfix="powpills"]'); pg.wait_for_timeout(500)
    ok('quitar el fijo devuelve el total original', total(pg) == base)

    # mensaje de cotización
    pg.locator('.qBtn').first.click(); pg.wait_for_timeout(300)
    t = pg.inner_text('#sheet')
    ok('cotización: mensaje en inglés con envío a Bulgaria y COA', 'shipped to Bulgaria' in t and 'certificate of analysis' in t)
    pg.click('#sheet details summary'); pg.wait_for_timeout(200)
    ok('cotización: traducción al español', 'envío a Bulgaria (UE)' in pg.inner_text('#sheet'))
    ok('cotización: botón de WhatsApp', pg.locator('#sheet a', has_text='WhatsApp').count() == 1)
    pg.click('#sheet [data-close]')

    # actualización semanal: clave incorrecta, luego la buena; se conservan las selecciones
    tab(pg, 'productos'); pg.locator('details.prod[data-id="11"] .pActive').uncheck(); pg.wait_for_timeout(200)
    tab(pg, 'ajustes'); pg.fill('#syncKey', 'clave-equivocada'); pg.click('#btnSyncSave'); pg.wait_for_timeout(2500)
    ok('clave incorrecta: lo dice y no cambia los datos', 'Clave incorrecta' in pg.inner_text('#syncInfo') and '(v5)' in pg.inner_text('#dataInfo'))
    pg.fill('#syncKey', KEY); pg.click('#btnSyncSave'); pg.wait_for_timeout(3000)
    ok('clave correcta: descarga y aplica los datos nuevos', '(v6)' in pg.inner_text('#dataInfo'))
    ok('novedades visibles en el Plan', 'Novedades de los datos' in pg.inner_text('#updateNote'))
    tab(pg, 'productos')
    ok('la actualización conserva tus selecciones', not pg.locator('details.prod[data-id="11"] .pActive').is_checked())
    pg.locator('details.prod[data-id="11"] .pActive').check(); tab(pg, 'plan'); pg.wait_for_timeout(500)
    ok('tras actualizar, el plan vuelve a 2.006,57 € (sin cambios de precio en v6)', total(pg) == base)
    pg.click('#chgOk'); pg.wait_for_timeout(200)
    ok('«Entendido» oculta las novedades', pg.inner_text('#updateNote').strip() == '')
    pg.reload(); pg.wait_for_timeout(2500)
    ok('al reabrir no vuelve a aplicar lo mismo', pg.inner_text('#updateNote').strip() == '' and '(v6)' in pg.inner_text('#dataInfo'))
    ok('proveedor con análisis marcado', 'Con análisis independientes' in pg.inner_text('#results') or pg.locator('.vend[data-id="aurora"]').count() == 1)

    # anchos y tamaños de letra: sin desbordar
    for size in ('grande', 'enorme'):
        pg.evaluate(f"document.documentElement.dataset.size='{size}'")
        for w in (320, 360):
            pg.set_viewport_size({'width': w, 'height': 760}); bad = []
            for t_ in ('plan', 'productos', 'proveedores', 'ajustes'):
                tab(pg, t_)
                sw = pg.evaluate('document.documentElement.scrollWidth')
                if sw > w: bad.append(f'{t_}:{sw}')
            tab(pg, 'plan'); pg.locator('.qBtn').first.click(); pg.wait_for_timeout(250)
            dw = pg.evaluate("Math.max(...[...document.querySelectorAll('#sheet, #sheet *')].map(e => e.getBoundingClientRect().right))")
            if dw > w + 1: bad.append(f'ventana:{dw}')
            pg.click('#sheet [data-close]')
            ok(f'letra {size} a {w}px sin desbordar' + (f' {bad}' if bad else ''), not bad)
    b.close()

print('\nErrores de consola:', errors or 'ninguno')
fails = [n for n, c in results if not c]
print(f'{len(results) - len(fails)}/{len(results)} comprobaciones superadas')
sys.exit(1 if fails or errors else 0)
