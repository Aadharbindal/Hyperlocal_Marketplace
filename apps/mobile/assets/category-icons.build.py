"""Cut the category icons out of the reference strip the user supplied.

    python category-icons.build.py <reference.png> <out-dir>

The reference is three white cards side by side, each holding a rendered 3D icon on a soft
tinted circle. Each icon is lifted out with its circle, because the circle is part of how the
icon reads - flat on a plain background they look like clip art.

The cut is by connectivity, not by colour. Keying out white would also eat the white inside the
icons: the chrome highlight on the tap, the glass on the bulb, the light edge of the hammer. So
"background" means white **and reachable from the border**, which the card is and the highlights
are not - they are enclosed by the icon around them.

The circle's tint fades to white at its rim, so the fill stops somewhere in that fade rather
than at a hard edge. That is the right place for it to stop: by then the tint is within a few
values of white and the cut is invisible. A light feather takes care of the rest.
"""
import sys
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter

SRC, OUT_DIR = sys.argv[1], Path(sys.argv[2])
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Each card's centre in the strip, and the box to take around it.
CARDS = [('plumbing', 157), ('electrical', 476), ('carpentry', 793)]
HALF, TOP, BOTTOM = 110, 25, 245
# The card's own white. Anything this close to it, and joined to the edge, is background.
CARD_WHITE = (254, 254, 254)
TOLERANCE = 6
FEATHER = 1.0

src = Image.open(SRC).convert('RGB')

for name, cx in CARDS:
    crop = src.crop((cx - HALF, TOP, cx + HALF, BOTTOM))
    w, h = crop.size
    cp = crop.load()

    def is_card(x, y):
        p = cp[x, y]
        return max(abs(p[i] - CARD_WHITE[i]) for i in range(3)) <= TOLERANCE

    reachable = [[False] * h for _ in range(w)]
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_card(x, y):
                reachable[x][y] = True
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_card(x, y) and not reachable[x][y]:
                reachable[x][y] = True
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not reachable[nx][ny] and is_card(nx, ny):
                reachable[nx][ny] = True
                queue.append((nx, ny))

    mask = Image.new('L', (w, h), 255)
    mp = mask.load()
    kept = 0
    for x in range(w):
        for y in range(h):
            if reachable[x][y]:
                mp[x, y] = 0
            else:
                kept += 1

    # A sanity check in the same spirit as the hero build: if the cut kept almost nothing, or
    # almost everything, something is wrong and a silently bad icon is worse than a failure.
    share = kept / (w * h)
    if not 0.15 < share < 0.85:
        raise SystemExit('%s: kept %.0f%% of the box - the cut looks wrong' % (name, 100 * share))

    out = crop.convert('RGBA')
    out.putalpha(mask.filter(ImageFilter.GaussianBlur(FEATHER)))
    out = out.crop(out.getbbox())
    path = OUT_DIR / ('icon-%s.png' % name)
    out.save(path)
    print('wrote %s %dx%d (kept %.0f%%)' % (path.name, out.width, out.height, 100 * share))
