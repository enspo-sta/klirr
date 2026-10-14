"""Download the plot images the extractors read, from the URLs in sources.json.

The images belong to Erin's Audio Corner and are not stored in this repository. Run this before
re-running the extraction:

    cd research/lsi
    python3 fetch_sources.py            # downloads into images/
    cd images
    python3 ../lsi_extract.py ../cfg_separate.json ../out
    python3 ../lsi_extract.py ../cfg_combined.json ../outc
    python3 ../hd_extract.py ../cfg_hd.json ../outhd

The extractors need numpy, Pillow and the tesseract command-line program.
"""
import json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'images')


def main():
    os.makedirs(OUT, exist_ok=True)
    sources = json.load(open(os.path.join(HERE, 'sources.json')))
    for name, url in sources.items():
        dest = os.path.join(OUT, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print('have', name)
            continue
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (klirr fetch_sources)'})
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, 'wb') as f:
            f.write(r.read())
        print('got ', name, os.path.getsize(dest), 'bytes')
    print(len(sources), 'images in', OUT)


if __name__ == '__main__':
    sys.exit(main())
