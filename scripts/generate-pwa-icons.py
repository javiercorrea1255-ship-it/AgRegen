"""Generate PWA icons for AgRegen from the official logo.

Source logo: attached_assets/605AE7C5-7F27-45EE-B9ED-DF274584579A_1776548826837.png
  (RGBA PNG with transparent background, 1536x1024)

Outputs to client/public/:
  icon-192.png            (192x192, any, rounded corners)
  icon-512.png            (512x512, any, rounded corners)
  icon-maskable-512.png   (512x512, maskable: full-bleed green background)
  apple-touch-icon.png    (180x180, rounded corners)
  favicon.png             (32x32)

Brand: #15803d green background, official logo mark (circular leaf symbol).
The script crops the circular mark from the left portion of the source logo
and centers it on a solid green background for each output size.
"""
from PIL import Image, ImageDraw
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "client" / "public"

# Official source logo — transparent PNG, 1536x1024
_LOGO_CANDIDATES = [
    ROOT / "attached_assets" / "605AE7C5-7F27-45EE-B9ED-DF274584579A_1776548826837.png",
]

GREEN = (21, 128, 61, 255)  # #15803d brand green


def _load_mark() -> Image.Image:
    """Load and crop the circular logo mark from the source image."""
    for path in _LOGO_CANDIDATES:
        if path.exists():
            src = Image.open(path).convert("RGBA")
            arr = np.array(src)
            alpha = arr[:, :, 3]

            # Locate non-transparent content
            rows_with_content = np.any(alpha > 10, axis=1)
            cols_with_content = np.any(alpha > 10, axis=0)
            rmin = int(np.where(rows_with_content)[0][0])
            rmax = int(np.where(rows_with_content)[0][-1])
            cmin = int(np.where(cols_with_content)[0][0])
            cmax = int(np.where(cols_with_content)[0][-1])

            # Find the gap between the circular icon mark and the text wordmark.
            # The gap is a vertical band with very few opaque pixels.
            content_h = rmax - rmin
            gap_threshold = content_h * 0.05
            col_density = np.array([
                float(np.sum(alpha[rmin:rmax, c] > 10))
                for c in range(cmin, cmax)
            ])
            gap_cols = np.where(col_density < gap_threshold)[0]
            if len(gap_cols) > 0:
                # Use the first gap to separate icon mark from text
                icon_end_col = cmin + int(gap_cols[0])
            else:
                # Fallback: use the left 40% of content width
                icon_end_col = cmin + int((cmax - cmin) * 0.40)

            mark = src.crop((cmin, rmin, icon_end_col, rmax))
            print(f"Logo mark cropped: {mark.size} from {path.name}")
            return mark

    raise FileNotFoundError(
        "Source logo not found. Place the official AgRegen PNG at:\n"
        + "\n".join(f"  {p}" for p in _LOGO_CANDIDATES)
    )


def _make_icon(mark: Image.Image, size: int, maskable: bool = False) -> Image.Image:
    """Center the logo mark on a green background square."""
    bg = Image.new("RGBA", (size, size), GREEN)
    # Maskable icons need content within the 80% safe zone;
    # regular icons look better with a slightly larger mark.
    safe_frac = 0.72 if maskable else 0.82
    max_content = int(size * safe_frac)
    w, h = mark.size
    scale = min(max_content / w, max_content / h)
    new_w, new_h = int(w * scale), int(h * scale)
    scaled = mark.resize((new_w, new_h), Image.LANCZOS)
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    bg.paste(scaled, (x, y), scaled)
    return bg


def _round_corners(img: Image.Image, radius: int) -> Image.Image:
    """Apply rounded corners to a square icon (RGBA)."""
    size = img.width
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    result.paste(img, (0, 0), mask)
    return result


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    mark = _load_mark()

    targets = [
        # (filename,  size, maskable, rounded)
        ("icon-192.png", 192, False, True),
        ("icon-512.png", 512, False, True),
        ("icon-maskable-512.png", 512, True, False),
        ("apple-touch-icon.png", 180, False, True),
        ("favicon.png", 32, False, False),
    ]

    for name, size, maskable, rounded in targets:
        img = _make_icon(mark, size, maskable=maskable)
        if rounded:
            img = _round_corners(img, radius=size // 5)
        img.save(OUT / name, "PNG", optimize=True)
        print(f"  wrote {name}  ({size}x{size}{'  maskable' if maskable else ''})")

    print("\nAll PWA icons generated successfully.")


if __name__ == "__main__":
    main()
