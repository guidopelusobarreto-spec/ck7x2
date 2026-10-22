#!/usr/bin/env python3
"""Cifra y descifra los datos de la app (datos.enc). El repositorio es público: aquí solo hay código, nunca datos.

Uso:
  CLAVE='…' python3 tools/datos.py cifrar datos.json datos.enc
  CLAVE='…' python3 tools/datos.py descifrar datos.enc datos.json
  python3 tools/datos.py cambios antes.json despues.json     # lista de cambios de precio legible (para «changes»)

Formato compatible con WebCrypto en app.js: PBKDF2-SHA256 (310 000 iteraciones) → AES-GCM 256, etiqueta al final del texto cifrado.
Requiere: pip install cryptography
"""
import base64, json, os, sys
from datetime import datetime, timezone

ITER = 310_000


def _key(clave, salt, it):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=it).derive(clave.encode())


def cifrar(datos: dict, clave: str) -> dict:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(clave, salt, ITER)).encrypt(iv, json.dumps(datos, ensure_ascii=False).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return {'v': 1, 'kdf': 'PBKDF2-SHA256', 'iter': ITER, 'salt': b(salt), 'iv': b(iv), 'ct': b(ct),
            'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}


def descifrar(pack: dict, clave: str) -> dict:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    d = lambda x: base64.b64decode(x)
    pt = AESGCM(_key(clave, d(pack['salt']), pack['iter'])).decrypt(d(pack['iv']), d(pack['ct']), None)
    return json.loads(pt)


def cambios(a: dict, b: dict) -> list:
    """Cambios de precio, ofertas nuevas y retiradas entre dos versiones (textos para el campo «changes»)."""
    prod = {p['id']: p['name'] for p in b['products']}
    ven = {v['id']: v['name'] for v in b['vendors']}
    old = {o['id']: o for o in a['offers']}
    new = {o['id']: o for o in b['offers']}
    out = []
    for i, o in new.items():
        n = f"{prod.get(o['productId'], o['productId'])} · {ven.get(o['vendorId'], o['vendorId'])}"
        if i not in old:
            out.append(f"Nueva oferta: {n} — {o['price']} {o['currency']} ({o['desc']})")
        elif (old[i]['price'], old[i]['currency'], old[i]['units']) != (o['price'], o['currency'], o['units']):
            out.append(f"Precio: {n} — {old[i]['price']} → {o['price']} {o['currency']}")
        elif old[i].get('active', True) and not o.get('active', True):
            out.append(f"Oferta desactivada: {n} — {o.get('status', '')}")
    for i, o in old.items():
        if i not in new:
            out.append(f"Oferta retirada: {prod.get(o['productId'], o['productId'])} · {ven.get(o['vendorId'], o['vendorId'])}")
    for c in ('USD', 'INR'):
        if a['fx'].get(c) != b['fx'].get(c):
            out.append(f"Tipo de cambio {c}: {a['fx'].get(c)} → {b['fx'].get(c)} por €")
    return out


if __name__ == '__main__':
    cmd, src, dst = (sys.argv[1:4] + [None] * 3)[:3]
    if cmd == 'cambios':
        print('\n'.join(cambios(json.load(open(src)), json.load(open(dst)))) or 'Sin cambios')
        sys.exit(0)
    clave = os.environ.get('CLAVE')
    if not clave or cmd not in ('cifrar', 'descifrar') or not dst:
        sys.exit(__doc__)
    if cmd == 'cifrar':
        datos = json.load(open(src, encoding='utf-8'))
        for k in ('products', 'vendors', 'offers'):
            assert isinstance(datos.get(k), list), f'falta {k}'
        json.dump(cifrar(datos, clave), open(dst, 'w'))
        assert descifrar(json.load(open(dst)), clave) == json.loads(json.dumps(datos, ensure_ascii=False)), 'comprobación fallida'
        print(f'cifrado y comprobado: {dst}')
    else:
        json.dump(descifrar(json.load(open(src)), clave), open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'descifrado: {dst}')
