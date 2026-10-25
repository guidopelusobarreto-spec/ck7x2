# Pruebas de la app

Todas se ejecutan contra un servidor local (`python3 -m http.server 8766 --bind 127.0.0.1` en la raíz del repo) con Chromium/Playwright.
**Los datos nunca van al repo**: los ficheros JSON de datos y la clave se pasan como argumentos o variables de entorno.

| Script | Qué comprueba | Uso |
|---|---|---|
| `e2e.py` | 23 comprobaciones generales (320/360 px, letra grande y enorme, actualización cifrada) | `DATA_FILE=datos-v5.json ENC_FILE=datos-v6.enc CLAVE='…' python3 -I tests/e2e.py http://127.0.0.1:8766/` |
| `plan.py` | Imprime el plan (nivel C+ y con D) de un fichero de datos | `python3 -I tests/plan.py URL datos.json` |
| `sync.py` | Importa unos datos, añade un proveedor propio y sincroniza con otros cifrados (retirada de proveedores, ofertas huérfanas, plan) | `python3 -I tests/sync.py URL antes.json despues.enc CLAVE` |
| `targets.py` | Al sincronizar se renuevan los objetivos salvo los editados a mano | `python3 -I tests/targets.py URL antes.json despues.enc CLAVE` |
| `size_keep.py` | La cantidad de prueba elegida se conserva al sincronizar | `python3 -I tests/size_keep.py URL antes.json despues.enc CLAVE` |
| `customs.py` | Aviso y tope de aduana (150 €, solo envíos por correo) | `python3 -I tests/customs.py URL datos.json` |
| `trial50.py` | Pedido de prueba de minoxidil, dutasterida, finasterida y tadalafilo en 50 (cantidades reales y mensaje de cotización); guarda una captura | `python3 -I tests/trial50.py URL datos.json carpeta_capturas` |

Cifrar o descifrar datos: `CLAVE='…' python3 tools/datos.py cifrar|descifrar origen destino`; diferencias: `python3 tools/datos.py cambios antes.json despues.json`.
