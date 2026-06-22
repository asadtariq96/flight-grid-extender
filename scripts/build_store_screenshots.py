from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "store-assets"
TEMP = Path.home() / "AppData" / "Local" / "Temp"

SOURCES = [
    (
        TEMP / "codex-clipboard-0ddfc1ba-621b-4afb-b6e0-21ac73697ddf.png",
        ASSETS / "screenshot_1280x800.png",
        "Compare a full month of fares at a glance",
        "Select any fare to search its exact departure and return dates.",
        [(175, 18, 216, 68), (246, 18, 290, 68), (1455, 178, 1521, 238), (1455, 248, 1521, 308)],
    ),
    (
        TEMP / "codex-clipboard-849dccfc-6235-477a-8860-fe0e1860ab10.png",
        ASSETS / "screenshot_hover_1280x800.png",
        "Trace departure and return dates instantly",
        "Hover a fare to reveal its departure column and return row.",
        [(205, 18, 247, 70), (278, 18, 323, 70), (1487, 178, 1524, 240), (1487, 248, 1524, 310)],
    ),
]

BACKGROUND = "#202124"
PRIMARY = "#f1f3f4"
SECONDARY = "#bdc1c6"
ACCENT = "#8ab4f8"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "arialbd.ttf" if bold else "arial.ttf"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size)


def remove_navigation_arrows(image: Image.Image, boxes: list[tuple[int, int, int, int]]) -> None:
    draw = ImageDraw.Draw(image)
    fill = image.getpixel((image.width // 2, 40))
    for box in boxes:
        draw.rectangle(box, fill=fill)


def build(
    source: Path,
    output: Path,
    title: str,
    subtitle: str,
    arrow_boxes: list[tuple[int, int, int, int]],
) -> None:
    shot = Image.open(source).convert("RGB")
    remove_navigation_arrows(shot, arrow_boxes)

    # Some clipboard captures include a narrow black browser gutter.
    if max(shot.getpixel((0, shot.height // 2))) < 20:
        shot = shot.crop((16, 0, shot.width, shot.height))

    canvas = Image.new("RGB", (1280, 800), BACKGROUND)
    draw = ImageDraw.Draw(canvas)

    draw.text((48, 34), title, font=font(34, bold=True), fill=PRIMARY)
    draw.text((48, 82), subtitle, font=font(19), fill=SECONDARY)

    max_width, max_height = 1280, 620
    scale = min(max_width / shot.width, max_height / shot.height)
    resized = shot.resize(
        (round(shot.width * scale), round(shot.height * scale)),
        Image.Resampling.LANCZOS,
    )
    x = (canvas.width - resized.width) // 2
    y = 146 + (max_height - resized.height) // 2
    canvas.paste(resized, (x, y))

    draw.rounded_rectangle((48, 748, 310, 782), radius=17, fill="#303134")
    draw.ellipse((62, 758, 74, 770), fill=ACCENT)
    draw.text((84, 754), "Google Flights only", font=font(16), fill=SECONDARY)

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, "PNG", optimize=True)


for source, output, title, subtitle, arrow_boxes in SOURCES:
    if not source.exists():
        raise FileNotFoundError(source)
    build(source, output, title, subtitle, arrow_boxes)
