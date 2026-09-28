"""Cut the house illustration out of the reference banner the user supplied.

    python hero-house.build.py <reference.webp> hero-house.png

The reference is a landscape banner: green gradient, headline and button on the left, an
isometric house with clouds and tool chips on the right. Only the illustration is wanted - the
text is rebuilt in the app so it can be translated, scale with the system font size and be read
aloud, none of which a picture of words can do.

Two things make the cut-out harder than a colour key.

The background is a smooth two-dimensional gradient, so it is modelled from the four corners and
subtracted. That alone is not enough: the roof, the trees and the bushes are greens close enough
to the background that a threshold punches holes straight through them. What separates them is
not colour but *connectivity* - the background is one region touching the border and the
illustration is an island - so the mask is a flood fill inward from the edges.

And the flood fill needs one guard. An earlier version of this script lost the paint-roller chip
entirely: the fill crept through the soft glow around it and then found the chip's own frosted
interior close enough to the gradient to keep going. Anything clearly brighter than the
background it sits on is therefore never treated as background, whatever the fill thinks. The
script checks afterwards that every bright element it found in the source is still in the
output, and refuses to write a file that has quietly lost one.
"""
import sys
from collections import deque
from PIL import Image, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]

# The banner sits inside a frame in the supplied file, and has rounded corners.
BANNER = (7, 6, 1250, 661)
# Far enough in to sample gradient, not corner radius.
INSET = 38
# The illustration's bounding box, leaving the headline and button behind.
BOX = (600, 62, 1248, 566)
# How close to the modelled gradient a pixel must be to count as background.
TOLERANCE = 16
# How much brighter than its background a pixel must be to be protected outright.
BRIGHT_MARGIN = 25
FEATHER = 0.8

src = Image.open(SRC).convert('RGB')
px = src.load()
X0, Y0, X1, Y1 = BANNER
c00 = px[X0 + INSET, Y0 + INSET]
c10 = px[X1 - INSET, Y0 + INSET]
c01 = px[X0 + INSET, Y1 - INSET]
c11 = px[X1 - INSET, Y1 - INSET]


def background(x, y):
    """The gradient's colour here, bilinearly interpolated from the banner's corners."""
    fx, fy = (x - X0) / (X1 - X0), (y - Y0) / (Y1 - Y0)
    return [(c00[i] * (1 - fx) + c10[i] * fx) * (1 - fy) + (c01[i] * (1 - fx) + c11[i] * fx) * fy for i in range(3)]


luma = lambda p: 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]

crop = src.crop(BOX)
cw, ch = crop.size
cp = crop.load()


def is_background(x, y):
    p = cp[x, y]
    b = background(x + BOX[0], y + BOX[1])
    if luma(p) > luma(b) + BRIGHT_MARGIN:
        return False  # a cloud, a chip, a lit window: never background, whatever the fill wants
    return max(abs(p[i] - b[i]) for i in range(3)) < TOLERANCE


reachable = [[False] * ch for _ in range(cw)]
queue = deque()
for x in range(cw):
    for y in (0, ch - 1):
        if is_background(x, y):
            reachable[x][y] = True
            queue.append((x, y))
for y in range(ch):
    for x in (0, cw - 1):
        if is_background(x, y) and not reachable[x][y]:
            reachable[x][y] = True
            queue.append((x, y))

while queue:
    x, y = queue.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < cw and 0 <= ny < ch and not reachable[nx][ny] and is_background(nx, ny):
            reachable[nx][ny] = True
            queue.append((nx, ny))

mask = Image.new('L', (cw, ch), 255)
mp = mask.load()
for x in range(cw):
    for y in range(ch):
        if reachable[x][y]:
            mp[x, y] = 0

# --- did anything bright go missing? -----------------------------------------------------
# Every distinctly bright blob in the source - the clouds, the chips, the lit windows - has to
# still be there. This is the check that would have caught the lost paint roller.
seen = [[False] * ch for _ in range(cw)]
blobs = []
for sx in range(cw):
    for sy in range(ch):
        p = cp[sx, sy]
        if seen[sx][sy] or luma(p) < luma(background(sx + BOX[0], sy + BOX[1])) + 60:
            continue
        stack = [(sx, sy)]
        seen[sx][sy] = True
        pixels = []
        while stack:
            x, y = stack.pop()
            pixels.append((x, y))
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < cw and 0 <= ny < ch and not seen[nx][ny]:
                    q = cp[nx, ny]
                    if luma(q) >= luma(background(nx + BOX[0], ny + BOX[1])) + 60:
                        seen[nx][ny] = True
                        stack.append((nx, ny))
        if len(pixels) > 400:
            blobs.append(pixels)

lost = [b for b in blobs if sum(1 for (x, y) in b if mp[x, y] > 128) < 0.5 * len(b)]
print('bright elements found: %d' % len(blobs))
if lost:
    for b in lost:
        xs = [x for x, _ in b]
        ys = [y for _, y in b]
        print('  LOST a %d-pixel element around (%d,%d)' % (len(b), sum(xs) // len(xs), sum(ys) // len(ys)))
    raise SystemExit('refusing to write: the cut-out dropped part of the illustration')

out = crop.convert('RGBA')
out.putalpha(mask.filter(ImageFilter.GaussianBlur(FEATHER)))
out = out.crop(out.getbbox())  # trim the transparent margin so the asset is all illustration
out.save(OUT)
print('wrote %s %dx%d' % (OUT, out.width, out.height))
