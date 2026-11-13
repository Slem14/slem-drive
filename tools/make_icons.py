#!/usr/bin/env python3
"""Generate the glassy gauge app icons (180/192/512)."""
import math
from PIL import Image, ImageDraw, ImageFilter

BASE = 1024


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def make_base():
    img = Image.new("RGB", (BASE, BASE), (5, 6, 10))
    # soft color blobs
    blobs = Image.new("RGB", (BASE, BASE), (5, 6, 10))
    bd = ImageDraw.Draw(blobs)
    bd.ellipse([-300, -300, 550, 550], fill=(122, 22, 38))
    bd.ellipse([500, 520, 1350, 1350], fill=(138, 59, 18))
    bd.ellipse([550, -250, 1250, 450], fill=(60, 15, 30))
    blobs = blobs.filter(ImageFilter.GaussianBlur(180))
    img = Image.blend(img, blobs, 0.85)

    d = ImageDraw.Draw(img, "RGBA")
    cx, cy, r = BASE // 2, BASE // 2, 330
    width = 72

    # 270° gauge arc with gradient (ice -> violet), drawn in segments
    start, sweep = 135, 270
    c1, c2 = (255, 94, 98), (255, 179, 71)
    glow = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    steps = 120
    frac = 0.72  # arc fill fraction
    for i in range(int(steps * frac)):
        t = i / steps
        a0 = start + sweep * t
        a1 = start + sweep * (i + 1.4) / steps
        col = lerp(c1, c2, t)
        box = [cx - r, cy - r, cx + r, cy + r]
        gd.arc(box, a0, a1, fill=col + (255,), width=width)
    glow_blur = glow.filter(ImageFilter.GaussianBlur(26))
    img.paste(glow_blur, (0, 0), glow_blur)
    img.paste(glow, (0, 0), glow)

    # faint track for the rest of the arc
    d.arc([cx - r, cy - r, cx + r, cy + r], start + sweep * frac, start + sweep,
          fill=(255, 255, 255, 40), width=width)

    # round end caps
    for ang, col in [(start, c1), (start + sweep * frac, lerp(c1, c2, frac))]:
        rad = math.radians(ang)
        x = cx + r * math.cos(rad)
        y = cy + r * math.sin(rad)
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=col + (255,))

    # speed digits
    try:
        from PIL import ImageFont
        font = None
        for name in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-ExtraLight.ttf",
                     "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
            try:
                font = ImageFont.truetype(name, 300)
                break
            except OSError:
                continue
        if font:
            d.text((cx, cy + 10), "88", font=font, fill=(240, 245, 250, 255), anchor="mm")
    except Exception:
        pass

    # glass top highlight
    hl = Image.new("L", (BASE, BASE), 0)
    hd = ImageDraw.Draw(hl)
    hd.ellipse([-200, -520, BASE + 200, int(BASE * 0.45)], fill=38)
    hl = hl.filter(ImageFilter.GaussianBlur(60))
    white = Image.new("RGB", (BASE, BASE), (255, 255, 255))
    img.paste(white, (0, 0), hl)
    return img


def rounded(img, radius_frac=0.224):
    """Apply iOS-style rounded corners (for favicon/192/512; iOS rounds 180 itself)."""
    size = img.size[0]
    radius = int(size * radius_frac)
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


base = make_base()
base.resize((180, 180), Image.LANCZOS).save("icons/icon-180.png")  # apple-touch: square
rounded(base.resize((192, 192), Image.LANCZOS)).save("icons/icon-192.png")
rounded(base.resize((512, 512), Image.LANCZOS)).save("icons/icon-512.png")
print("icons written")
