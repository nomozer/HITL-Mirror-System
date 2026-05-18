"""
gen_test_papers.py — Generate synthetic Vietnamese exam papers + student
work for end-to-end testing the HITL grader.

Run:
    python scripts/gen_test_papers.py [out_dir]

Default out_dir = ./test_papers/.

Outputs three pairs (đề + bài làm), one per subject:
  - test_math_de.pdf      + test_math_baLam.pdf
  - test_chem_de.pdf      + test_chem_baLam.pdf
  - test_bio_de.pdf       + test_bio_baLam.pdf

Each bài làm is intentionally seeded with 1-2 small mistakes so the AI
has substantive content to flag (not "Không có lỗi" sentinels everywhere).
Vietnamese rendering uses Arial from C:\\Windows\\Fonts — works on
Windows; on other OS swap the FONT_PATH at the top.

This is for DEV testing only — not a production exam authoring tool. The
content is short (3-5 câu) and stylistically simple so each grading call
stays under ~20s.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import fitz  # PyMuPDF

# Windows default stdout is cp1252; reconfigure to UTF-8 so the script's
# friendly print statements don't crash mid-run on a non-Latin glyph.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Windows-friendly default. Override via env var ARIAL_PATH if needed.
FONT_PATH = os.environ.get("ARIAL_PATH", r"C:\Windows\Fonts\arial.ttf")
FONT_NAME = "viFont"


PAGE_MARGIN = 50  # pts
LINE_HEIGHT = 16
SECTION_GAP = 10


def write_pdf(out_path: Path, title: str, lines: list[str]) -> None:
    """Render ``title`` + ``lines`` to a single-page A4 PDF with Vietnamese
    glyph support. Each entry in ``lines`` is one line; empty strings are
    blank lines (paragraph break).

    PyMuPDF's standalone ``get_text_length`` only knows the 14 PDF base
    fonts. For text-width measurements on the Arial TTF we load a
    ``fitz.Font`` directly and use its ``text_length`` method.
    """
    vi_font = fitz.Font(fontfile=FONT_PATH)
    doc = fitz.open()
    page = doc.new_page()  # default A4
    page.insert_font(fontfile=FONT_PATH, fontname=FONT_NAME)

    width = page.rect.width
    y = PAGE_MARGIN

    # Title — bold-ish via a slightly larger size, centred.
    title_size = 14
    tw = vi_font.text_length(title, fontsize=title_size)
    page.insert_text(
        ((width - tw) / 2, y + title_size),
        title,
        fontname=FONT_NAME,
        fontsize=title_size,
    )
    y += title_size + SECTION_GAP

    body_size = 11
    for raw in lines:
        # Soft-wrap long lines so chemistry equations / proof steps don't
        # run off the right edge. fitz has no auto-wrap, so we measure and
        # break at the last space that fits.
        remaining = raw
        max_width = width - 2 * PAGE_MARGIN
        while remaining:
            piece = remaining
            while vi_font.text_length(piece, fontsize=body_size) > max_width:
                cut = piece.rfind(" ")
                if cut <= 0:
                    cut = max(1, len(piece) - 4)
                piece = piece[:cut]
            page.insert_text(
                (PAGE_MARGIN, y + body_size),
                piece,
                fontname=FONT_NAME,
                fontsize=body_size,
            )
            y += LINE_HEIGHT
            remaining = remaining[len(piece):].lstrip(" ")
        if not raw:
            y += LINE_HEIGHT // 2

    doc.save(str(out_path))
    doc.close()


# ---------------------------------------------------------------------------
# Math — quadratic equation arc, 3 câu
# ---------------------------------------------------------------------------

MATH_DE = [
    "Môn: Toán · Lớp 10 · Thời gian: 30 phút",
    "Họ tên học sinh: ………………………………………  Lớp: ……………",
    "",
    "Câu 1 (3.0 điểm). Giải phương trình: x² − 5x + 6 = 0.",
    "",
    "Câu 2 (4.0 điểm). Tìm m để phương trình",
    "       x² − 2(m + 1)x + m² − 3 = 0",
    "có hai nghiệm phân biệt.",
    "",
    "Câu 3 (3.0 điểm). Cho phương trình x² + bx + c = 0 có",
    "hai nghiệm là 2 và −5. Tìm b, c.",
]

# Student answer — intentionally:
#  · Câu 1: đúng đáp án và bước.
#  · Câu 2: tính Δ' đúng nhưng QUÊN khẳng định a = 1 ≠ 0 (pt bậc hai) +
#           không kết luận miền m rõ ràng.
#  · Câu 3: dùng Vi-ét đúng nhưng KHÔNG kiểm tra điều kiện Δ ≥ 0.
MATH_BAILAM = [
    "Họ tên: Trần Minh Khôi · Lớp 10A1",
    "",
    "Câu 1.",
    "x² − 5x + 6 = 0",
    "Δ = 25 − 24 = 1",
    "x = (5 ± 1) / 2",
    "→ x = 3 hoặc x = 2",
    "Vậy phương trình có hai nghiệm x = 2, x = 3.",
    "",
    "Câu 2.",
    "Để pt có 2 nghiệm phân biệt → Δ' > 0",
    "Δ' = (m+1)² − (m² − 3)",
    "    = m² + 2m + 1 − m² + 3",
    "    = 2m + 4",
    "2m + 4 > 0  →  m > −2",
    "Vậy m > −2 thì pt có 2 nghiệm phân biệt.",
    "",
    "Câu 3.",
    "Theo Vi-ét:",
    "x₁ + x₂ = −b  →  2 + (−5) = −b  →  b = 3",
    "x₁ · x₂ = c    →  2 · (−5) = c    →  c = −10",
    "Vậy b = 3, c = −10.",
]


# ---------------------------------------------------------------------------
# Hoá — cân bằng phương trình + tính theo phương trình, 3 câu
# ---------------------------------------------------------------------------

CHEM_DE = [
    "Môn: Hoá học · Lớp 10 · Thời gian: 30 phút",
    "Họ tên học sinh: ………………………………………  Lớp: ……………",
    "",
    "Câu 1 (3.0 điểm). Cân bằng các phương trình hoá học sau",
    "(viết rõ điều kiện nếu có):",
    "   a) Fe + H₂SO₄ (loãng) → FeSO₄ + H₂",
    "   b) Cu + H₂SO₄ (đặc, nóng) → CuSO₄ + SO₂ + H₂O",
    "",
    "Câu 2 (4.0 điểm). Cho 5,6 gam Fe phản ứng vừa đủ với",
    "dung dịch HCl. Tính:",
    "   a) Khối lượng muối FeCl₂ thu được.",
    "   b) Thể tích khí H₂ thoát ra ở điều kiện tiêu chuẩn.",
    "(Cho Fe = 56; H = 1; Cl = 35,5)",
    "",
    "Câu 3 (3.0 điểm). Xác định số oxi hoá của Mn trong các chất:",
    "MnO₂, KMnO₄, MnSO₄, K₂MnO₄.",
]

# Bài làm hoá — intentionally:
#  · Câu 1a: cân bằng đúng.
#  · Câu 1b: QUÊN cân bằng hệ số (viết 1 Cu + 1 H₂SO₄ → 1 CuSO₄ + 1 SO₂ + 1 H₂O,
#            không cân bằng đúng phải là Cu + 2H₂SO₄ → CuSO₄ + SO₂ + 2H₂O).
#  · Câu 2: tính M(FeCl₂) đúng nhưng dùng tỉ lệ mol Fe : HCl = 1 : 1 (sai,
#           phải là 1 : 2) → sai khối lượng HCl. Thể tích H₂ thì đúng vì
#           tỉ lệ Fe : H₂ = 1 : 1.
#  · Câu 3: 3 chất đúng, 1 chất sai (K₂MnO₄ → ghi +7 thay vì +6).
CHEM_BAILAM = [
    "Họ tên: Nguyễn Khánh An · Lớp 10A1",
    "",
    "Câu 1.",
    "a) Fe + H₂SO₄ → FeSO₄ + H₂",
    "b) Cu + H₂SO₄ → CuSO₄ + SO₂ + H₂O",
    "",
    "Câu 2.",
    "n(Fe) = 5,6 / 56 = 0,1 mol",
    "Fe + 2HCl → FeCl₂ + H₂",
    "Tỉ lệ Fe : HCl : FeCl₂ : H₂ = 1 : 1 : 1 : 1",
    "→ n(FeCl₂) = 0,1 mol; n(H₂) = 0,1 mol",
    "M(FeCl₂) = 56 + 2·35,5 = 127",
    "Khối lượng FeCl₂ = 0,1 · 127 = 12,7 gam.",
    "Thể tích H₂ ở đktc = 0,1 · 22,4 = 2,24 lít.",
    "",
    "Câu 3.",
    "MnO₂  : Mn có số oxi hoá +4",
    "KMnO₄ : Mn có số oxi hoá +7",
    "MnSO₄ : Mn có số oxi hoá +2",
    "K₂MnO₄: Mn có số oxi hoá +7",
]


# ---------------------------------------------------------------------------
# Sinh — di truyền Mendel, 3 câu
# ---------------------------------------------------------------------------

BIO_DE = [
    "Môn: Sinh học · Lớp 12 · Thời gian: 30 phút",
    "Họ tên học sinh: ………………………………………  Lớp: ……………",
    "",
    "Câu 1 (3.0 điểm). Ở đậu Hà Lan, gen A quy định hoa đỏ là trội",
    "hoàn toàn so với gen a quy định hoa trắng. Cho cây hoa đỏ",
    "thuần chủng (AA) lai với cây hoa trắng (aa).",
    "Xác định tỉ lệ kiểu gen và kiểu hình ở F1 và F2.",
    "",
    "Câu 2 (4.0 điểm). Cho phép lai AaBb × AaBb (hai gen độc lập,",
    "trội hoàn toàn). Tính:",
    "   a) Số loại giao tử và tỉ lệ giao tử của mỗi bên.",
    "   b) Tỉ lệ kiểu hình ở F1.",
    "",
    "Câu 3 (3.0 điểm). Phân biệt biến dị tổ hợp với đột biến gen.",
    "Cho một ví dụ minh hoạ cho mỗi loại.",
]

# Bài làm sinh — intentionally:
#  · Câu 1: F1 đúng (Aa, 100% đỏ), F2 đúng kiểu gen (1:2:1) nhưng kiểu hình
#           NHẦM tỉ lệ 3:1 thành 1:1 (lỗi điển hình).
#  · Câu 2: số loại giao tử + tỉ lệ ĐÚNG, nhưng tỉ lệ F1 ghi 9:3:3:1 ngược
#           thành 1:3:3:9 (vẫn đúng số nhưng thứ tự đảo).
#  · Câu 3: phân biệt đúng, ví dụ ổn.
BIO_BAILAM = [
    "Họ tên: Lê Thị Hà · Lớp 12A2",
    "",
    "Câu 1.",
    "P: AA (đỏ) × aa (trắng)",
    "F1: 100% Aa → kiểu hình 100% đỏ.",
    "F1 × F1: Aa × Aa",
    "F2 kiểu gen: 1 AA : 2 Aa : 1 aa",
    "F2 kiểu hình: 1 đỏ : 1 trắng.",
    "",
    "Câu 2.",
    "a) Cây AaBb cho 4 loại giao tử: AB, Ab, aB, ab",
    "   với tỉ lệ 1 : 1 : 1 : 1.",
    "b) F1 có 4 kiểu hình với tỉ lệ:",
    "   1 (aabb) : 3 (A−bb) : 3 (aaB−) : 9 (A−B−)",
    "",
    "Câu 3.",
    "− Biến dị tổ hợp: do tổ hợp lại các alen có sẵn của bố mẹ",
    "  trong quá trình giảm phân và thụ tinh.",
    "  Ví dụ: bố AaBb × mẹ AaBb → con có thể có kiểu gen aabb",
    "  (mới so với bố mẹ).",
    "− Đột biến gen: thay đổi cấu trúc gen (thay/mất/thêm cặp",
    "  nucleotide).",
    "  Ví dụ: bệnh hồng cầu hình liềm do đột biến thay thế A bằng T",
    "  trong gen β-globin.",
]


def main(argv: list[str]) -> int:
    out_dir = Path(argv[1] if len(argv) > 1 else "test_papers").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if not Path(FONT_PATH).exists():
        print(f"ERROR: font not found at {FONT_PATH}")
        print("  Set ARIAL_PATH env var to a Vietnamese-capable TTF.")
        return 1

    pairs = [
        ("test_math_de.pdf",      "ĐỀ KIỂM TRA TOÁN — LỚP 10",      MATH_DE),
        ("test_math_baLam.pdf",   "BÀI LÀM CỦA HỌC SINH (Toán)",     MATH_BAILAM),
        ("test_chem_de.pdf",      "ĐỀ KIỂM TRA HOÁ HỌC — LỚP 10",   CHEM_DE),
        ("test_chem_baLam.pdf",   "BÀI LÀM CỦA HỌC SINH (Hoá)",      CHEM_BAILAM),
        ("test_bio_de.pdf",       "ĐỀ KIỂM TRA SINH HỌC — LỚP 12",  BIO_DE),
        ("test_bio_baLam.pdf",    "BÀI LÀM CỦA HỌC SINH (Sinh)",     BIO_BAILAM),
    ]

    print(f"Output dir: {out_dir}\n")
    for filename, title, lines in pairs:
        out_path = out_dir / filename
        write_pdf(out_path, title, lines)
        print(f"  ✓ {filename}  ({out_path.stat().st_size:,} bytes)")

    print(f"\nDone. Upload each pair via step 1:")
    print("  • Toán : test_math_de.pdf  +  test_math_baLam.pdf")
    print("  • Hoá  : test_chem_de.pdf  +  test_chem_baLam.pdf")
    print("  • Sinh : test_bio_de.pdf   +  test_bio_baLam.pdf")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
