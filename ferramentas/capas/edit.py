import sys, os, glob, json
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
BATCH = os.environ.get('BATCH', '1')
if BATCH == '2':
    from spec2 import CAP, CAPBOX, TITLE, TITLE_TOP
else:
    from spec import CAP, CAPBOX, TITLE, TITLE_TOP

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r"C:/Users/User/Desktop/marketing/fotos de capa/originais"
F = lambda n: os.path.join(HERE, 'fonts', n)
ANTON, RUSSO, POPPINS, MARKER = F('Anton-Regular.ttf'), F('RussoOne-Regular.ttf'), F('Poppins-ExtraBold.ttf'), F('PermanentMarker-Regular.ttf')
X0, X1 = 438, 842
SW = X1 - X0

ocr = json.load(open(os.path.join(HERE, 'ocr2.json' if BATCH == '2' else 'ocr.json'), encoding='utf-8'))

def boxes(name):
    out = []
    for b, t, s in ocr[name]:
        xs = [p[0] for p in b]; ys = [p[1] for p in b]
        out.append((t, min(xs), min(ys), max(xs), max(ys)))
    return out

def caption_box(i, name):
    if i in CAPBOX: return CAPBOX[i]
    for t, a, b, c, d in boxes(name):
        if 340 <= b <= 395 and d - b >= 28 and a >= 470 and c <= 810:
            return (a, b, c, d)
    return None

def grade(bgr, i):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    mode = i % 3
    hue = [3.0, -3.0, 1.5][mode]
    sat = [1.10, 1.08, 1.16][mode]
    hsv[..., 0] = (hsv[..., 0] + hue) % 180
    hsv[..., 1] = np.clip(hsv[..., 1] * sat, 0, 255)
    out = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)
    tint = [(-6, 0, 8), (8, 3, -6), (4, -3, 5)][mode]
    out += np.array(tint, np.float32)
    c = [1.04, 1.03, 1.07][mode]
    out = (out - 128) * c + 128
    return np.clip(out, 0, 255).astype(np.uint8)

def median_color(bgr, box, smin=90):
    a, b, c, d = box
    reg = bgr[b:d, a:c].reshape(-1, 3)
    hsv = cv2.cvtColor(reg.reshape(-1, 1, 3), cv2.COLOR_BGR2HSV).reshape(-1, 3)
    m = (hsv[:, 1] > smin) & (hsv[:, 2] > 110)
    if m.sum() < 40: return None, None
    # dominant hue bucket among saturated pixels
    h = hsv[m, 0].astype(int)
    hist = np.bincount(((h + 5) % 180) // 10, minlength=18)
    k = hist.argmax()
    sel = m.copy(); sel[m] = (((h + 5) % 180) // 10) == k
    col = np.median(reg[sel], axis=0)
    return tuple(int(v) for v in col), int(np.median(hsv[sel, 0]))

def fit_font(path, text, max_w, max_h, start=200):
    s = start
    while s > 8:
        f = ImageFont.truetype(path, s)
        l, t, r, b = f.getbbox(text)
        if r - l <= max_w and b - t <= max_h: return f
        s -= 2
    return ImageFont.truetype(path, 8)

def cap_font(path, text, cap_h, max_w):
    s = 10
    while True:
        f = ImageFont.truetype(path, s + 1)
        l, t, r, b = f.getbbox('H')
        if b - t > cap_h or f.getbbox(text)[2] - f.getbbox(text)[0] > max_w: break
        s += 1
    return ImageFont.truetype(path, s)

def text_mask(size, text, font, xy, stroke=0, anchor='la'):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).text(xy, text, font=font, fill=255, stroke_width=stroke, stroke_fill=255, anchor=anchor)
    return m

def comp(base, mask, color, alpha=1.0):
    # base: PIL RGB, mask: L, color: rgb tuple or RGB image
    if isinstance(color, tuple):
        color = Image.new('RGB', base.size, color)
    a = mask.point(lambda v: int(v * alpha))
    base.paste(color, (0, 0), a)

def shadow(base, mask, off=(3, 4), blur=4, alpha=0.75):
    sh = Image.new('L', base.size, 0); sh.paste(mask, off)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    comp(base, sh, (0, 0, 0), alpha)

def draw_caption(pil, text, box, fill_bgr, hue):
    a, b, c, d = box
    a -= X0; c -= X0
    h = d - b
    cx, cy = (a + c) / 2, (b + d) / 2
    white_fill = fill_bgr is None
    red = (not white_fill) and (hue < 12 or hue > 168)
    font_path = RUSSO if red else POPPINS
    font = cap_font(font_path, text, h * 0.66, SW - 40)
    fill = (255, 255, 255) if white_fill else (fill_bgr[2], fill_bgr[1], fill_bgr[0])
    xy = (cx, cy)
    m_fill = text_mask(pil.size, text, font, xy, 0, 'mm')
    if red:
        m_w = text_mask(pil.size, text, font, xy, 3, 'mm')
        m_d = text_mask(pil.size, text, font, xy, 5, 'mm')
        shadow(pil, m_d, (2, 3), 3, 0.6)
        comp(pil, m_d, (25, 10, 10), 0.85)
        comp(pil, m_w, (255, 255, 255))
    else:
        m_d = text_mask(pil.size, text, font, xy, 4, 'mm')
        shadow(pil, m_d, (2, 3), 3, 0.6)
        comp(pil, m_d, (12, 12, 16))
    comp(pil, m_fill, fill)

def vgrad(size, top_rgb, bot_rgb, y0, y1):
    w, h = size
    t = np.clip((np.arange(h) - y0) / max(1, y1 - y0), 0, 1)[:, None, None]
    g = np.array(top_rgb, np.float32) * (1 - t) + np.array(bot_rgb, np.float32) * t
    return Image.fromarray(np.repeat(g, w, axis=1).astype(np.uint8))

def draw_title(pil, lines, accent_rgb, top):
    W, H = pil.size
    l1, l2, l3 = lines
    k = 1.0
    while True:
        f1 = fit_font(ANTON, l1, W - 24, int(108 * k))
        f2 = fit_font(ANTON, l2, W - 70, int(56 * k))
        f3 = fit_font(MARKER, l3, W - 46, int(76 * k))
        b1, b2, b3 = f1.getbbox(l1), f2.getbbox(l2), f3.getbbox(l3)
        h1, h2, h3 = b1[3] - b1[1], b2[3] - b2[1], b3[3] - b3[1]
        y1 = top + 4
        y2 = y1 + h1 + 8
        y3 = y2 + int(h2 * 0.92)
        if y3 + h3 <= H - 14 or k < 0.6: break
        k -= 0.05
    x = 12
    # line 1: white -> accent gradient
    m1 = text_mask(pil.size, l1, f1, (x - b1[0], y1 - b1[1]))
    m1s = m1.filter(ImageFilter.MaxFilter(5))
    shadow(pil, m1s, (3, 5), 5, 0.8)
    comp(pil, m1s, (20, 8, 8), 0.9)
    lite = tuple(int(255 * 0.72 + c * 0.28) for c in accent_rgb)
    comp(pil, m1, vgrad(pil.size, (255, 255, 255), accent_rgb, y1 + h1 * 0.15, y1 + h1 * 1.0))
    # line 2: italic accent
    m2 = text_mask(pil.size, l2, f2, (x + 4 - b2[0], y2 - b2[1]))
    sh = 0.22
    m2 = m2.transform(pil.size, Image.AFFINE, (1, sh, -sh * (y2 + h2), 0, 1, 0), Image.BICUBIC)
    m2s = m2.filter(ImageFilter.MaxFilter(5))
    shadow(pil, m2s, (3, 4), 4, 0.8)
    comp(pil, m2s, (20, 8, 8), 0.9)
    comp(pil, m2, accent_rgb)
    # line 3: white brush, right aligned, slight tilt, accent offset shadow
    layer = Image.new('L', (W, H), 0)
    ImageDraw.Draw(layer).text((W - 18 - (b3[2] - b3[0]) - b3[0], y3 - b3[1]), l3, font=f3, fill=255)
    layer = layer.rotate(4, resample=Image.BICUBIC, center=(W * 0.6, y3 + h3 / 2))
    acc = Image.new('L', (W, H), 0); acc.paste(layer, (-4, 3))
    shadow(pil, layer.filter(ImageFilter.MaxFilter(3)), (4, 5), 4, 0.8)
    comp(pil, acc, accent_rgb)
    comp(pil, layer, (255, 255, 255))

LOGO = (750 - X0, 6, 832 - X0, 84)
_lama = None

def lama(crop, mask):
    # LaMa inpainting on a crop (any size), resized to the model's 512x512 input
    global _lama
    if _lama is None:
        import onnxruntime as ort
        _lama = ort.InferenceSession(os.path.join(HERE, 'model', 'lama_fp32.onnx'), providers=['CPUExecutionProvider'])
    h, w = crop.shape[:2]
    img = cv2.resize(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB), (512, 512), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
    m = (cv2.resize(mask, (512, 512), interpolation=cv2.INTER_NEAREST) > 0).astype(np.float32)
    out = _lama.run(None, {'image': img.transpose(2, 0, 1)[None], 'mask': m[None, None]})[0][0].transpose(1, 2, 0)
    if out.max() <= 1.5: out = out * 255
    out = cv2.resize(np.clip(out, 0, 255).astype(np.uint8), (w, h), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)

def fill(strip, mask, box):
    # inpaint the crop `box` around a mark and paste back only the masked pixels (feathered)
    x0, y0, x1, y1 = box
    crop, m = strip[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    res = lama(crop, cv2.dilate(m, np.ones((5, 5), np.uint8)))
    a = cv2.GaussianBlur(cv2.dilate(m, np.ones((5, 5), np.uint8)).astype(np.float32) / 255, (5, 5), 0)[..., None]
    strip[y0:y1, x0:x1] = (res * a + crop * (1 - a)).astype(np.uint8)

def remove_marks(strip, i, name):
    # channel logo, top-right corner (text badge or plain lightning circle)
    a, b, c, d = LOGO
    hsv = cv2.cvtColor(strip[b:d, a:c], cv2.COLOR_BGR2HSV).astype(int)
    red = ((hsv[..., 0] < 10) | (hsv[..., 0] > 170)) & (hsv[..., 1] > 120) & (hsv[..., 2] > 110)
    if red.mean() > 0.06:
        mask = np.zeros(strip.shape[:2], np.uint8)
        cv2.ellipse(mask, ((a + c) // 2, (b + d) // 2), ((c - a) // 2, (d - b) // 2), 0, 0, 360, 255, -1)
        fill(strip, mask, (SW - 240, 0, SW, 240))
    # "HISTORIAS GEEK" watermark below the caption
    if i not in TITLE:
        cap = caption_box(i, name)
        y0 = max(410, cap[3] + 3) if cap else 410
        y1 = y0 + 48
        for t, bx0, by0, bx1, by1 in boxes(name):
            if 405 <= by0 <= 450 and bx0 >= 530 and bx1 <= 760 and by1 - by0 < 50 and (not cap or by0 > cap[3] - 4):
                y0, y1 = min(y0, by0 - 4), max(y1, by1 + 6)
        mask = np.zeros(strip.shape[:2], np.uint8)
        mask[y0:y1, 540 - X0:742 - X0] = 255
        cy = (y0 + y1) // 2
        fill(strip, mask, (0, cy - 202, SW, cy + 202))
    return strip

def process(i, path):
    name = os.path.basename(path)
    img = cv2.imdecode(np.fromfile(path, np.uint8), 1)
    strip = remove_marks(img[:, X0:X1].copy(), i, name)
    pil_after = None
    if i in TITLE:
        tb = [bx for bx in boxes(name) if bx[2] > 380 and bx[4] - bx[2] > 30]
        top = TITLE_TOP.get(i, min([bx[2] for bx in tb], default=440))
        # accent colour from the 2nd title line (or whole block)
        ref = (tb[1][1], tb[1][2], tb[1][3], tb[1][4]) if len(tb) >= 2 else (X0, top, X1, 715)
        col, hue = median_color(img, ref, 110)
        if col is None: col, hue = (40, 40, 225), 0
        y0 = max(0, top - 12)
        reg = strip[y0:]
        hsv = cv2.cvtColor(reg, cv2.COLOR_BGR2HSV).astype(int)
        dh = np.minimum(np.abs(hsv[..., 0] - hue), 180 - np.abs(hsv[..., 0] - hue))
        m = ((hsv[..., 2] > (165 if i == 167 else 185)) & (hsv[..., 1] < (110 if i == 167 else 80))) | ((hsv[..., 1] > 100) & (dh < (0 if i == 167 else 14)) & (hsv[..., 2] > 80)) | (hsv[..., 2] < 50)
        m = cv2.dilate(m.astype(np.uint8) * 255, np.ones((7, 7), np.uint8))
        mask = np.zeros(strip.shape[:2], np.uint8); mask[y0:] = m
        strip = cv2.inpaint(strip, mask, 9, cv2.INPAINT_TELEA)
        strip = grade(strip, i)
        # soft dark gradient at the bottom to seat the new title
        g = np.clip((np.arange(720) - (top - 60)) / (720 - (top - 60)), 0, 1) ** 1.3 * 0.62
        strip = (strip.astype(np.float32) * (1 - g[:, None, None])).astype(np.uint8)
        pil = Image.fromarray(cv2.cvtColor(strip, cv2.COLOR_BGR2RGB))
        draw_title(pil, TITLE[i], (col[2], col[1], col[0]), top)
    else:
        box = caption_box(i, name) if i in CAP else None
        if box:
            col, hue = median_color(img, (box[0] + 4, box[1] + 6, box[2] - 4, box[3] - 6))
            a, b, c, d = box
            mask = np.zeros(strip.shape[:2], np.uint8)
            mask[max(0, b - 7):d + 6, max(0, a - X0 - 8):min(SW, c - X0 + 8)] = 255
            strip = cv2.inpaint(strip, mask, 7, cv2.INPAINT_TELEA)
        strip = grade(strip, i)
        pil = Image.fromarray(cv2.cvtColor(strip, cv2.COLOR_BGR2RGB))
        if box:
            draw_caption(pil, CAP[i], box, col, hue if hue is not None else 0)
    strip = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    # rebuild the darkened zoomed background from the edited strip
    H = round(720 * 1280 / SW)
    big = cv2.resize(strip, (1280, H), interpolation=cv2.INTER_LINEAR)
    yo = (H - 720) // 2
    out = (big[yo:yo + 720].astype(np.float32) * 0.30).astype(np.uint8)
    out[:, X0:X1] = strip
    return out

if __name__ == '__main__':
    dst = sys.argv[1]
    only = set(map(int, sys.argv[2:]))
    files = [os.path.join(SRC, n) for n in ocr]
    assert all(os.path.exists(f) for f in files)
    for i, f in enumerate(files):
        if only and i not in only: continue
        out = process(i, f)
        cv2.imencode('.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tofile(os.path.join(dst, os.path.basename(f)))
    print('done')
