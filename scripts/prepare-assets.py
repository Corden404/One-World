"""Prepare web assets and Depth Anything V2 maps using Tiefling's preprocessing."""
from pathlib import Path
import argparse
import math
import numpy as np
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parents[2]
assets = root / 'worlds' / 'dist' / 'assets'
parser = argparse.ArgumentParser()
parser.add_argument('--depth', action='store_true')
selection = parser.add_mutually_exclusive_group()
selection.add_argument('--wide-only', action='store_true')
selection.add_argument('--expansion-only', action='store_true')
selection.add_argument('--papercut-only', action='store_true')
args = parser.parse_args()
sources = [('开灯.png', 'forest-on'), ('关灯.png', 'forest-off'), ('场景2.png', 'ocean-on'), ('generated/wood-connector.png', 'wood-connector')]
wide_sources = [('generated/forest-wide-on.png', 'forest-wide-on'), ('generated/forest-wide-off.png', 'forest-wide-off'), ('generated/ocean-wide-on.png', 'ocean-wide-on')]
expansion_sources = [(f'generated/expansion/{name}-{state}.png', f'{name}-{state}')
                     for name in ['cloud', 'snow', 'observatory'] for state in ['on', 'off']]
expansion_sources += [(f'generated/expansion/{name}-connector.png', f'{name}-connector')
                      for name in ['ocean-cloud', 'cloud-snow', 'snow-observatory']]
paper_names = ['paper-bamboo', 'paper-town', 'paper-train']
papercut_sources = [(f'generated/papercut/{name}-{state}.png', f'{name}-{state}')
                    for name in paper_names for state in ['on', 'off']]
papercut_sources += [(f'generated/papercut/{name}.png', name) for name in
                     ['forest-off-aligned', 'ocean-off', 'observatory-bamboo-connector',
                      'bamboo-town-connector', 'town-train-connector', 'train-forest-connector']]
sources = (wide_sources if args.wide_only else expansion_sources if args.expansion_only else
           papercut_sources if args.papercut_only else sources + wide_sources + expansion_sources + papercut_sources)
for source, name in sources:
    if not (root / source).exists():
        continue
    image = Image.open(root / source).convert('RGB')
    image.thumbnail((2048, 1600), Image.Resampling.LANCZOS)
    image.save(assets / f'{name}.webp', quality=92, method=6)
    print(f'{name}: {image.size}', flush=True)
if args.depth:
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    model = root / '.cache' / 'depthanythingv2-vits-dynamic-quant.onnx'
    session = ort.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider'])
    print('Model:', [(x.name, x.shape) for x in session.get_inputs()], flush=True)
    names = (['forest-wide', 'ocean-wide'] if args.wide_only else
             ['cloud', 'snow', 'observatory'] if args.expansion_only else paper_names if args.papercut_only else
             ['forest', 'ocean', 'forest-wide', 'ocean-wide', 'cloud', 'snow', 'observatory'] + paper_names)
    for name in names:
        if not (assets / f'{name}-on.webp').exists():
            continue
        image = Image.open(assets / f'{name}-on.webp').convert('RGB')
        size = 518  # multiple of the model's 14px patch size
        ratio = min(size / image.width, size / image.height)
        w, h = math.ceil(image.width * ratio), math.ceil(image.height * ratio)
        ox, oy = math.ceil((size - w) / 2), math.ceil((size - h) / 2)
        square = Image.new('RGB', (size, size))
        square.paste(image.resize((w, h), Image.Resampling.LANCZOS), (ox, oy))
        tensor = np.asarray(square, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
        depth = session.run(None, {session.get_inputs()[0].name: tensor})[0].squeeze()
        depth = (depth - depth.min()) / max(float(depth.max() - depth.min()), 1e-6)
        output = Image.fromarray((depth * 255).astype(np.uint8))
        output = output.resize((size, size), Image.Resampling.BILINEAR).crop((ox, oy, ox+w, oy+h))
        # Tiefling expands near surfaces to reduce stretched silhouettes.
        output = output.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(.6))
        output.save(assets / f'{name}-depth.png')
        print(f'{name} depth: {output.size}', flush=True)
