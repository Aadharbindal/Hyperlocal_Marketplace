"""Cut the house illustration out of the reference banner the user supplied.

    python hero-house.build.py <reference.png> hero-house.png

The reference is a 757x400 landscape banner: green gradient, headline and button on the left,
an isometric house with clouds and tool chips on the right. Only the illustration is wanted -
the text is rebuilt in the app so it can be translated, scale with the system font size and be
read aloud, none of which a picture of words can do.

The background is a smooth two-dimensional gradient, so it can be modelled from the four corners
and subtracted. That alone is not enough: the roof, the trees and the bushes are greens close
enough to the background that a colour threshold punches holes straight through them. What
separates them is not colour but *connectivity* - the background is one region touching the
border, and the illustration is an island. So the mask is a flood fill inward from the edges,
and anything the fill cannot reach stays, whatever shade of green it happens to be.
"""
import sys
from collections import deque
from PIL import Image, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]

# The illustration's bounding box in the reference, leaving the headline and button behind.
BOX = (370, 35, 757, 340)
# How close to the modelled gradient a pixel must be to count as background. Low enough not to
# eat the darkest parts of the roof, high enough to cover the gradient's own banding.
TOLERANCE = 16
# Just enough to stop the cut-out looking like scissors once it sits on the app's own gradient.
FEATHER = 0.6

src = Image.open(SRC).convert('RGB')
W, H = src.size
px = src.load()
c00, c10, c01, c11 = px[0, 0], px[W - 1, 0], px[0, H - 1], px[W - 1, H - 1]


def background(x, y):
    """The gradient's colour here, bilinearly interpolated from the corners."""
    fx, fy = x / (W - 1), y / (H - 1)
    return [(c00[i] * (1 - fx) + c10[i] * fx) * (1 - fy) + (c01[i] * (1 - fx) + c11[i] * fx) * fy for i in range(3)]


crop = src.crop(BOX)
cw, ch = crop.size
cp = crop.load()


def looks_like_background(x, y):
    p = cp[x, y]
    b = background(x + BOX[0], y + BOX[1])
    return max(abs(p[i] - b[i]) for i in range(3)) < TOLERANCE


reachable = [[False] * ch for _ in range(cw)]
queue = deque()
for x in range(cw):
    for y in (0, ch - 1):
        if looks_like_background(x, y):
            reachable[x][y] = True
            queue.append((x, y))
for y in range(ch):
    for x in (0, cw - 1):
        if looks_like_background(x, y) and not reachable[x][y]:
            reachable[x][y] = True
            queue.append((x, y))

while queue:
    x, y = queue.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < cw and 0 <= ny < ch and not reachable[nx][ny] and looks_like_background(nx, ny):
            reachable[nx][ny] = True
            queue.append((nx, ny))

mask = Image.new('L', (cw, ch), 255)
mp = mask.load()
for x in range(cw):
    for y in range(ch):
        if reachable[x][y]:
            mp[x, y] = 0

out = crop.convert('RGBA')
out.putalpha(mask.filter(ImageFilter.GaussianBlur(FEATHER)))
out.save(OUT)
print('wrote %s %dx%d' % (OUT, out.width, out.height))
