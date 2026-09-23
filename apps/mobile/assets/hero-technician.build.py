"""Rebuild the welcome hero asset from the pristine extraction, step by step."""
import sys
from collections import deque
from PIL import Image, ImageFilter

SRC = sys.argv[1]
OUT = sys.argv[2]

im = Image.open(SRC).convert('RGBA')
px = im.load()
w, h = im.size

# 1. dissolve the hard top edge (content starts around y=150)
alpha = im.split()[3].load()
FADE, HARD = 200, 18
for y in range(FADE):
    t = max(0.0, (y - HARD) / (FADE - HARD))
    k = t * t * (3 - 2 * t)
    for x in range(w):
        v = alpha[x, y]
        if v:
            alpha[x, y] = int(v * k)

# 2. let the decorative mint field fade in from white instead of meeting it in one row
mask = Image.new('L', (w, h), 0)
mp = mask.load()
for y in range(h):
    for x in range(w):
        R, G, B, A = px[x, y]
        if A < 8:
            continue
        lum = 0.299 * R + 0.587 * G + 0.114 * B
        if G - R > 6 and 205 < lum < 251:
            mp[x, y] = 255
mask = mask.filter(ImageFilter.MedianFilter(5))
mp = mask.load()
RAMP, WHITE = 190.0, (252, 254, 254)
for x in range(w):
    y0 = next((y for y in range(h) if mp[x, y] > 128), None)
    if y0 is None:
        continue
    for y in range(y0, min(h, y0 + int(RAMP))):
        t = (y - y0) / RAMP
        k = (1 - (t * t * (3 - 2 * t))) * 0.94
        R, G, B, A = px[x, y]
        px[x, y] = (int(R + (WHITE[0] - R) * k), int(G + (WHITE[1] - G) * k), int(B + (WHITE[2] - B) * k), A)


def laplace_fill(pixels, region, rounds=600):
    """Reconstruct `region` from its border - the areas we touch are smooth gradients."""
    val = {p: [0.0, 0.0, 0.0] for p in region}

    def get(p):
        if p in val:
            return val[p]
        q = pixels[p]
        return [float(q[0]), float(q[1]), float(q[2])]

    pts = sorted(region)
    for _ in range(rounds):
        for (x, y) in pts:
            a, b, c, e = get((x - 1, y)), get((x + 1, y)), get((x, y - 1)), get((x, y + 1))
            val[(x, y)] = [(a[i] + b[i] + c[i] + e[i]) / 4.0 for i in range(3)]
    for p in pts:
        v = val[p]
        pixels[p] = (int(v[0] + .5), int(v[1] + .5), int(v[2] + .5), pixels[p][3])


# 3. remove the baked-in script line - components of green that are not the uniform
X0, X1, Y0, Y1 = 372, 600, 636, 892
raw = {}
for y in range(Y0, Y1):
    for x in range(X0, X1):
        R, G, B, A = px[x, y]
        raw[(x, y)] = A > 40 and (G - R) > 10 and (G - B) > 5

script, seen = set(), set()
for p in raw:
    if not raw[p] or p in seen:
        continue
    comp, q, touches_edge = [], deque([p]), False
    seen.add(p)
    while q:
        c = q.popleft()
        comp.append(c)
        if c[0] >= X1 - 2:
            touches_edge = True
        for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (c[0] + d[0], c[1] + d[1])
            if n in raw and raw[n] and n not in seen:
                seen.add(n)
                q.append(n)
    if not touches_edge and len(comp) < 4200:
        script.update(comp)

grown = set()
for (x, y) in script:
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            if X0 <= x + dx < X1 and Y0 <= y + dy < Y1:
                grown.add((x + dx, y + dy))
laplace_fill(px, grown)
print('pass 1 removed', len(grown), 'px')

im.save(OUT)
print('saved', OUT)

# 4. the tail of the script sits on the trousers - rebuild that band from the clean
#    rows above and below, shifting them so the leg silhouette stays aligned.
def leg_edge(y):
    for x in range(470, 575):
        if all(px[x + i, y][3] > 40 and (px[x + i, y][1] - px[x + i, y][0]) > 25 for i in range(8)):
            return x
    return None


sA, sB = 716, 752
eA, eB = leg_edge(sA), leg_edge(sB)
for yt in range(718, 752):
    t = (yt - sA) / float(sB - sA)
    e = eA + (eB - eA) * t
    dA, dB = int(round(e - eA)), int(round(e - eB))
    for x in range(505, 556):
        a, b = px[x - dA, sA], px[x - dB, sB]
        px[x, yt] = (int(a[0] + (b[0] - a[0]) * t), int(a[1] + (b[1] - a[1]) * t), int(a[2] + (b[2] - a[2]) * t), px[x, yt][3])

im.save(OUT)
print('script tail rebuilt')
