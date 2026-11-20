"""Convert the app's web fonts (woff2) to ttf instances the native Android views can load.
Output: plex-client/android/app/src/main/assets/native-fonts/<family>-<weight>.ttf + index.json
Run: python scripts/build-native-fonts.py
"""
import io, json, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = os.path.join('plex-client', 'fonts')
OUT = os.path.join('plex-client', 'android', 'app', 'src', 'main', 'assets', 'native-fonts')
WEIGHTS = [400, 500, 600, 700, 800]

# family key -> either 'variable:<file>' or {weight: file}
FAMILIES = {
    'switzer': {400: 'switzer-400', 500: 'switzer-500', 700: 'switzer-700', 900: 'switzer-900'},
    'satoshi': {700: 'satoshi-700', 900: 'satoshi-900'},
    'inter': 'inter-variable', 'roboto': 'roboto-variable', 'nunito': 'nunito-variable',
    'montserrat': 'montserrat-variable', 'lexend': 'lexend-variable', 'lora': 'lora-variable',
    'playfair': 'playfair-display-variable', 'slab': 'roboto-slab-variable', 'mono': 'jetbrains-mono-variable',
    'oswald': 'oswald-variable', 'comfortaa': 'comfortaa-variable', 'orbitron': 'orbitron-variable',
    'caveat': 'caveat-variable', 'cinzel': 'cinzel-variable', 'merriweather': 'merriweather-variable',
    'script': 'dancing-script-variable', 'fredoka': 'fredoka-variable',
    'typewriter': {400: 'special-elite-regular'}, 'marker': {400: 'permanent-marker-regular'},
    'comic': {400: 'bangers-regular'},
    'creato': {300: 'creato-300', 400: 'creato-400', 500: 'creato-500', 700: 'creato-700', 900: 'creato-900'},
    'liberation': {400: 'liberation-400', 700: 'liberation-700'},
    'altone': {400: 'altone-400', 700: 'altone-700'},
    'codec': {300: 'codec-300', 400: 'codec-400', 700: 'codec-700', 900: 'codec-900'},
    'justsans': {400: 'justsans-400', 800: 'justsans-800'},
    'romance': {300: 'romance-300', 400: 'romance-400', 700: 'romance-700'},
}

def load(name):
    f = TTFont(os.path.join(SRC, name + '.woff2'))
    f.flavor = None
    return f

def save(font, path):
    buf = io.BytesIO()
    font.save(buf)
    with open(path, 'wb') as fh:
        fh.write(buf.getvalue())

def main():
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for fam, spec in FAMILIES.items():
        weights = []
        if isinstance(spec, dict):
            for w, name in spec.items():
                save(load(name), os.path.join(OUT, f'{fam}-{w}.ttf'))
                weights.append(w)
        else:
            for w in WEIGHTS:
                font = load(spec)
                axes = {a.axisTag: a for a in font['fvar'].axes} if 'fvar' in font else {}
                if 'wght' in axes:
                    a = axes['wght']
                    use = max(a.minValue, min(a.maxValue, w))
                    inst = instancer.instantiateVariableFont(font, {'wght': use}, inplace=False)
                else:
                    inst = font
                save(inst, os.path.join(OUT, f'{fam}-{w}.ttf'))
                weights.append(w)
        index[fam] = sorted(weights)
        print(fam, index[fam])
    with open(os.path.join(OUT, 'index.json'), 'w') as fh:
        json.dump(index, fh)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print('total KB', total // 1024)

if __name__ == '__main__':
    main()
