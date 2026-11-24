"""Gera os ícones do Radexa Desktop (app e bandeja). Rode: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(ROOT, exist_ok=True)
TEAL, NAVY = (13, 148, 136), (15, 34, 64)


def font(size):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def app_icon(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            px[x, y] = tuple(int(TEAL[i] * (1 - t) + NAVY[i] * t) for i in range(3)) + (255,)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    f = font(int(size * 0.62))
    box = d.textbbox((0, 0), "R", font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1] - size * 0.02), "R", font=f, fill="white")
    return img


def tray_icon(size, color):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(int(size * 0.9))
    box = d.textbbox((0, 0), "R", font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), "R", font=f, fill=color)
    return img


app_icon().save(os.path.join(ROOT, "icon.png"))
# macOS: imagem "template" (preta com transparência) se adapta ao tema da barra de menus
tray_icon(16, (0, 0, 0, 255)).save(os.path.join(ROOT, "trayTemplate.png"))
tray_icon(32, (0, 0, 0, 255)).save(os.path.join(ROOT, "trayTemplate@2x.png"))
app_icon(64).resize((32, 32), Image.LANCZOS).save(os.path.join(ROOT, "tray.png"))
print("ícones gerados em", os.path.abspath(ROOT))
