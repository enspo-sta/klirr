"""Assembles Klirr into single self-contained HTML files.

    python3 build.py

writes
  dist/klirr.html    the page body for a Claude artifact (the artifact host adds doctype, head and body)
  dist/index.html    a complete standalone page, used for GitHub Pages and for opening the app locally
  dist/harness.html  the artifact body inside a copy of the artifact host's skeleton, used by the browser tests
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda *p: os.path.join(HERE, *p)
DIST = P('dist')
APP_FILES = ['core.js', 'app_state.js', 'views_analysis.js', 'views_listen.js', 'views_manage.js', 'main.js']


def read(*p):
    with open(P(*p), encoding='utf-8') as f:
        return f.read()


def build():
    t = read('src', 'template.html')
    css = read('src', 'app.css')
    lib = json.loads(read('library.json'))
    lib_s = json.dumps(lib, separators=(',', ':')).replace('</', '<\\/')
    eng = read('engine.js').replace('</script', '<\\/script')
    app = '\n'.join(read('src', f) for f in APP_FILES).replace('</script', '<\\/script')
    body = t.replace('{{CSS}}', css).replace('{{LIBRARY}}', lib_s).replace('{{ENGINE}}', eng).replace('{{APP}}', app)
    os.makedirs(DIST, exist_ok=True)
    with open(os.path.join(DIST, 'klirr.html'), 'w', encoding='utf-8') as f:
        f.write(body)

    # standalone page: title, meta and style go to <head>, the rest to <body>
    cut = body.index('<header')
    head, rest = body[:cut], body[cut:]
    standalone = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
                  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
                  '<style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}'
                  'img{max-width:100%}[hidden]{display:none!important}</style>'
                  + head + '</head><body>' + rest + '</body></html>')
    with open(os.path.join(DIST, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(standalone)

    # the same kind of skeleton the Claude artifact host adds (light colour scheme and an off-white ground),
    # so the tests see the page the way the artifact does
    sk = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
          '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}'
          'body{margin:0;font:14px system-ui;background:#fafaf7}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
    with open(os.path.join(DIST, 'harness.html'), 'w', encoding='utf-8') as f:
        f.write(sk + body + '</body></html>')
    print('dist/klirr.html', len(body) // 1024, 'KB; dist/index.html', len(standalone) // 1024, 'KB; dist/harness.html')


if __name__ == '__main__':
    build()
