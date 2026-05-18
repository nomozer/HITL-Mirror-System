"""
prompts/bio.py — Sinh học-specific prompt content.

Provides Rule 8 (calibration examples) + Rule 9 (biology crosscheck) for
Biology grading. The rest of the prompt (Rules 1–7, 9b anchors, persona,
rubric) is shared via ``prompts.base``.

Upgrade tips:
  - When you see recurring teacher corrections on Sinh, add a new example
    to _RULE_8_BIO so the Grader calibrates scoring against it.
  - When Gemini misses a specific biology pitfall (Punnett square error,
    wrong taxonomic level, missing limiting factor), add a bullet to
    _RULE_9_BIO.
"""

from __future__ import annotations

from .base import compose_grader_system


_RULE_8_BIO = (
    "8. VÍ DỤ HIỆU CHỈNH (KHÔNG chép các ví dụ này vào transcript):\n\n"
    "— CHÉP TRANSCRIPT —\n"
    "• Tên khoa học (binomial nomenclature): chép NGUYÊN format, vd"
    " 'Homo sapiens' viết nghiêng / gạch dưới khi học sinh thể hiện rõ"
    " — chữ Latinh đầu viết hoa, chữ thứ hai viết thường. KHÔNG tự sửa.\n"
    "• Kiểu gen, kiểu hình: 'AaBb', 'AABBCc', 'X^A X^a' (gen trên NST"
    " giới tính) — chép NGUYÊN chữ hoa/thường + chỉ số trên/dưới.\n"
    "• Sơ đồ lai (Punnett square / khung Punnett): mô tả bằng wrapper"
    " '[Sơ đồ lai: <mô tả cấu trúc>]', KHÔNG vẽ ASCII art.\n"
    "• Nhãn 'a)', 'b)' phải xuất hiện. Bài ≥5 dòng/câu: chép TOÀN BỘ.\n\n"
    "— CHẤM ĐIỂM SINH HỌC (calibrate) —\n"
    "• Đúng kiểu gen P, sai tỉ lệ kiểu hình F1 (nhầm 3:1 thành 1:1):"
    " content=5.5, argument=7.0, expression=7.0, creativity=5.0 → overall=6.0.\n"
    "• Đúng phương pháp tính xác suất, sai bước nhân xác suất các"
    " sự kiện độc lập:"
    " content=6.0, argument=8.0, expression=7.0, creativity=5.0 → overall=6.5.\n"
    "• Đúng đáp án nhưng không giải thích cơ chế sinh học (vì sao):"
    " content=8.0, argument=7.5, expression=6.0, creativity=4.0 → overall=6.5.\n"
    "• Phân loại đúng cấp ngành/lớp/bộ nhưng nhầm họ/chi/loài:"
    " content=6.5, argument=6.0, expression=7.0, creativity=5.5 → overall=6.5.\n"
    "• Chỉ liệt kê đặc điểm, không liên hệ với chức năng / thích nghi:"
    " content=7.5, argument=4.0, expression=6.5, creativity=3.5 → overall=5.5.\n"
    "• Mô tả chu trình (Krebs, quang hợp, nhân đôi DNA) đúng các bước"
    " nhưng bỏ vai trò của enzyme / điều kiện:"
    " content=6.0, argument=6.5, expression=7.0, creativity=5.0 → overall=6.0."
)


_RULE_9_BIO = (
    "9. ĐỐI SOÁT LOGIC (SINH HỌC):\n"
    "• Bài di truyền (Mendel + sau Mendel):\n"
    "  - Kiểu gen P → giao tử có đúng quy luật phân li không? AaBb cho"
    " 4 loại giao tử với tỉ lệ 1:1:1:1 (gen độc lập); nếu liên kết hoàn"
    " toàn thì chỉ 2 loại.\n"
    "  - Tỉ lệ F1, F2 dựa trên Punnett — đếm thật cẩn thận. Tỉ lệ 9:3:3:1"
    " (2 gen độc lập, đồng trội), 3:1 (1 gen, trội-lặn hoàn toàn), 1:2:1"
    " (1 gen, trội không hoàn toàn). Nhầm tỉ lệ → trừ 'content' nặng.\n"
    "  - Gen trên NST giới tính (liên kết X): tỉ lệ kiểu hình khác giữa"
    " con đực và cái — kiểm tra học sinh có phân biệt không.\n"
    "• Bài sinh thái:\n"
    "  - Chuỗi / lưới thức ăn: mũi tên chỉ chiều truyền năng lượng (con"
    " mồi → con ăn thịt), KHÔNG ngược lại.\n"
    "  - Hiệu suất sinh thái ~10% giữa các bậc dinh dưỡng — học sinh tính"
    " đúng tỉ lệ không?\n"
    "  - Nhân tố giới hạn: học sinh có xác định nhân tố nào (ánh sáng,"
    " nhiệt độ, độ ẩm, dinh dưỡng) đang giới hạn quần thể không?\n"
    "• Bài tế bào / sinh học phân tử:\n"
    "  - Cấu trúc DNA: A-T (2 liên kết H), G-C (3 liên kết H) — học sinh"
    " viết đúng tỉ lệ % và số liên kết H không?\n"
    "  - Phiên mã / dịch mã: mã di truyền đọc theo bộ 3 (codon), từ 5'"
    " → 3' của mRNA. Học sinh có đọc đúng chiều không?\n"
    "  - Đột biến: phân loại đột biến gen (thay thế / mất / thêm cặp"
    " nucleotide) khác đột biến NST (cấu trúc / số lượng). Trừ điểm nếu"
    " gọi sai loại.\n"
    "• Bài tiến hoá: học sinh phân biệt chọn lọc tự nhiên (Darwin) vs"
    " biến dị (Lamarck) đúng chưa? Không nhầm 'sự cần thiết → biến đổi'"
    " (Lamarck sai) với 'biến dị có sẵn + chọn lọc' (Darwin đúng).\n"
    "• Bài phân loại: cấp bậc taxon (Giới → Ngành → Lớp → Bộ → Họ → Chi"
    " → Loài) — học sinh dùng đúng thứ tự + viết hoa đúng quy ước.\n"
    "• Tự tính lại / kiểm tra đáp án chuẩn trong đầu (KHÔNG ghi"
    " transcript). Dùng để đối soát.\n"
    "• Lỗi PHẢI ghi RÕ trong per_question_feedback.errors: chỉ đích danh"
    " bước sai + lý do sinh học. Vd: 'Em viết Aa × Aa cho F1 tỉ lệ 1:1 —"
    " sai vì AA, Aa, aa sinh ra theo Punnett là 1:2:1 (kiểu gen) hay 3:1"
    " (kiểu hình), không phải 1:1.'\n"
    "• 'content' phản ánh độ đúng của ĐÁP ÁN + CHUỖI LẬP LUẬN sinh học,"
    " KHÔNG độ đẹp chữ. Tỉ lệ F1 sai dù trình bày đẹp → 'content' KHÔNG"
    " được cao.\n"
    "• Kết quả đối soát CHỈ xuất hiện ở comment / errors — KHÔNG sửa transcript."
)


GRADER_SYSTEM_BIO = compose_grader_system(_RULE_8_BIO, _RULE_9_BIO)
