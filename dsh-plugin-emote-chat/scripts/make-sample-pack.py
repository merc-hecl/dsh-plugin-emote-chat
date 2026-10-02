"""Generate a small sample sticker pack for dsh-plugin-emote-chat.

The pack doubles as a manual smoke test for the whole pipeline: a static image,
two animated GIFs (so animation support is visible at a glance), and an SVG with
an explicit size.

Usage:
    python scripts/make-sample-pack.py [output-dir]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "samples" / "packs" / "whale")

NAVY = (26, 42, 92)
BLUE = (91, 124, 255)
LIGHT = (198, 214, 255)
WHITE = (255, 255, 255)
GOLD = (255, 215, 94)
PINK = (255, 143, 171)


def frame(face: str, *, eye: float = 1.0, mouth: float = 1.0, sprite: str = "🐳", offset: float = 0.0) -> Image.Image:
    """Render one 240×240 sticker frame."""
    size = 240
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((16, 16, size - 16, size - 16), radius=52, fill=NAVY)

    # Water line behind the whale.
    for index in range(3):
        y = 74 + index * 16
        draw.arc((24, y, 216, y + 62), 200, 340, fill=LIGHT, width=4)

    box = (58, 66, 182, 190)
    if offset:
        box = (box[0], box[1] + offset, box[2], box[3] + offset)
    draw.ellipse(box, fill=BLUE)
    # Tail.
    draw.polygon(
        [(168, 118), (212, 96 + offset), (206, 150 + offset)],
        fill=BLUE,
    )
    draw.ellipse((74, 96, 96, 118), fill=WHITE)  # eye white
    draw.ellipse((82, 104, 92, 114 - 4 * (1 - eye)), fill=NAVY)
    draw.arc((104, 132, 152, 168), 20, 160, fill=NAVY, width=5)  # smile

    # Small sprite marker under the whale (drawn, so no font is required).
    if face == "happy":
        draw.ellipse((106, 208, 122, 224), fill=GOLD)
    elif face == "sleepy":
        draw.rounded_rectangle((106, 214, 134, 220), radius=3, fill=LIGHT)
    elif face == "love":
        draw.polygon([(108, 214), (116, 206), (124, 214), (116, 224)], fill=PINK)
    else:
        draw.ellipse((108, 212, 132, 220), fill=WHITE)

    if face == "happy":
        draw.ellipse((150, 74, 176, 100), fill=GOLD)
        draw.text((157, 78), "!", fill=NAVY)
    elif face == "sleepy":
        draw.line((74, 108, 98, 108), fill=NAVY, width=4)
        draw.text((150, 70), "z", fill=LIGHT)
        draw.text((166, 54), "Z", fill=LIGHT)
    elif face == "love":
        draw.polygon([(150, 88), (162, 74), (174, 88), (162, 104)], fill=PINK)
    elif face == "shock":
        draw.ellipse((146, 74, 172, 104), outline=GOLD, width=4)
        draw.ellipse((154, 84, 164, 94), fill=GOLD)

    if mouth < 1:
        draw.rectangle((104, 140, 152, 158), fill=NAVY)

    return image


def write_gif(path: Path, frames: list[Image.Image], durations: list[int]) -> None:
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        transparency=0,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "hello.png").write_bytes(b"")  # placeholder replaced below
    frame("hello").save(OUT / "hello.png")

    # A blinking whale: two frames alternate the eye.
    blink = [frame("hello", eye=1.0), frame("hello", eye=0.2), frame("hello", eye=1.0)]
    write_gif(OUT / "blink.gif", blink, [420, 120, 420])

    # A happy whale that bobs up and down.
    bob = []
    for step in range(8):
        offset = math.sin(step / 8 * 2 * math.pi) * 6
        bob.append(frame("happy", offset=offset))
    write_gif(OUT / "happy.gif", bob, [90] * 8)

    (OUT / "thanks.svg").write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
  <rect width="220" height="220" rx="46" fill="#1a2a5c"/>
  <ellipse cx="106" cy="128" rx="62" ry="52" fill="#5b7cff"/>
  <polygon points="158,110 202,86 196,140" fill="#5b7cff"/>
  <circle cx="84" cy="120" r="9" fill="#ffffff"/>
  <path d="M92 152c14 12 34 12 48 0" stroke="#1a2a5c" stroke-width="6" fill="none" stroke-linecap="round"/>
  <text x="110" y="52" text-anchor="middle" font-family="Segoe UI Emoji, Apple Color Emoji, sans-serif" font-size="34">🙏</text>
</svg>
""",
        encoding="utf-8",
    )

    for entry in sorted(OUT.iterdir()):
        print(f"{entry.name}\t{entry.stat().st_size} bytes")


if __name__ == "__main__":
    main()
