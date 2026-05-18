"""
prompts/chem.py — Hóa học-specific prompt content.

Provides Rule 8 (calibration examples) + Rule 9 (chemistry crosscheck) for
Chemistry grading. The rest of the prompt (Rules 1–7, 9b anchors, persona,
rubric) is shared via ``prompts.base``.

Upgrade tips:
  - When you see recurring teacher corrections on Hoá, add a new example
    to _RULE_8_CHEM so the Grader calibrates scoring against it.
  - When Gemini misses a specific chemistry pitfall (unbalanced equation,
    wrong oxidation state, missing condition for reaction), add a bullet
    to _RULE_9_CHEM.
"""

from __future__ import annotations

from .base import compose_grader_system


_RULE_8_CHEM = (
    "8. VÍ DỤ HIỆU CHỈNH (KHÔNG chép các ví dụ này vào transcript):\n\n"
    "— CHÉP TRANSCRIPT —\n"
    "• Phương trình hoá học: chép NGUYÊN ký hiệu nguyên tố, chỉ số dưới,"
    " hệ số cân bằng. 'H₂SO₄' CHÉP là 'H₂SO₄', KHÔNG đổi thành 'H2SO4'"
    " (giữ Unicode subscript khi học sinh viết tay rõ).\n"
    "• Mũi tên phản ứng: '→' (1 chiều), '⇌' / '⇄' (thuận nghịch),"
    " '↑' (khí thoát), '↓' (kết tủa). Phân biệt rõ — nhầm '→' thành '⇌'"
    " là sai bản chất phản ứng.\n"
    "• Điều kiện phản ứng ghi trên/dưới mũi tên ('t°', 'xúc tác', 'as'):"
    " chép đầy đủ, KHÔNG bỏ qua. Nhãn 'a)', 'b)' phải xuất hiện.\n"
    "• Bài ≥5 dòng/câu: chép TOÀN BỘ — dừng sớm là thất bại nghiêm trọng.\n\n"
    "— CHẤM ĐIỂM HOÁ HỌC (calibrate) —\n"
    "• Đúng phương trình nhưng quên cân bằng hệ số (vd Fe + HCl → FeCl₂ + H₂"
    " thiếu hệ số 2 cho HCl):"
    " content=5.5, argument=7.5, expression=7.0, creativity=5.0 → overall=6.5.\n"
    "• Đúng phương pháp tính mol, sai bước cuối (nhầm khối lượng phân tử):"
    " content=6.0, argument=8.0, expression=7.0, creativity=5.0 → overall=6.5.\n"
    "• Đúng đáp án số nhưng không ghi đơn vị (mol, gam, lít):"
    " content=8.0, argument=8.0, expression=5.0, creativity=5.0 → overall=6.5.\n"
    "• Chỉ ghi sản phẩm cuối, không viết phương trình + không nêu loại"
    " phản ứng:"
    " content=7.0, argument=4.0, expression=3.5, creativity=3.5 → overall=4.5.\n"
    "• Nhận diện đúng loại phản ứng (oxi hoá-khử, axit-bazơ, trao đổi),"
    " thiếu xác định số oxi hoá / chất oxi hoá-chất khử:"
    " content=6.5, argument=7.0, expression=6.5, creativity=5.5 → overall=6.5.\n"
    "• Đúng phản ứng nhưng dùng sai điều kiện (vd dùng H₂SO₄ loãng cho"
    " phản ứng cần đặc, nóng):"
    " content=5.5, argument=5.0, expression=7.0, creativity=5.0 → overall=5.5."
)


_RULE_9_CHEM = (
    "9. ĐỐI SOÁT LOGIC (HOÁ HỌC):\n"
    "• Cân bằng phương trình: đếm số nguyên tử mỗi nguyên tố hai vế."
    " Khác nhau dù 1 nguyên tử cũng SAI — ghi rõ chỗ lệch trong"
    " per_question_feedback.errors.\n"
    "• Phản ứng oxi hoá-khử: kiểm tra số electron cho và nhận có cân"
    " bằng không. Nếu học sinh viết phương trình ion → kiểm tra điện tích"
    " cân bằng hai vế.\n"
    "• Tính toán theo phương trình:\n"
    "  - Đổi khối lượng → mol qua M (khối lượng phân tử) — học sinh có"
    " tính đúng M không? Vd M(H₂SO₄) = 98, không phải 96.\n"
    "  - Tỉ lệ mol đúng theo hệ số cân bằng — không nhầm 1:1 khi thực tế"
    " là 1:2.\n"
    "  - Thể tích khí ở đktc dùng 22.4 lít/mol (chỉ áp dụng cho khí ở"
    " 0°C, 1 atm — học sinh có kiểm tra điều kiện không?).\n"
    "• Điều kiện phản ứng:\n"
    "  - Axit đặc/loãng, nóng/lạnh có ảnh hưởng tới sản phẩm — vd"
    " Cu + H₂SO₄ loãng KHÔNG phản ứng; Cu + H₂SO₄ đặc, nóng → CuSO₄ +"
    " SO₂↑ + H₂O.\n"
    "  - Phản ứng cần xúc tác, nhiệt độ, ánh sáng — học sinh có ghi đầy"
    " đủ trên/dưới mũi tên không?\n"
    "• Tên gọi (IUPAC vs tên thường): học sinh dùng 'natri clorua' (đúng)"
    " hay 'muối ăn' (thông thường, không tính trong bài hoá). Trừ điểm"
    " trình bày khi cần tên IUPAC mà học sinh dùng tên thường.\n"
    "• Trạng thái chất: (r), (l), (k), (dd) — bắt buộc cho phương trình"
    " hoàn chỉnh ở cấp THPT. Thiếu → trừ điểm trình bày.\n"
    "• Tự tính lại đáp án chuẩn (trong đầu, KHÔNG ghi transcript) để so"
    " với đáp số học sinh.\n"
    "• Lỗi PHẢI ghi RÕ trong per_question_feedback.errors: chỉ đích danh"
    " bước sai + lý do hoá học. Vd: 'Em viết Fe + 2HCl → FeCl₂ + H₂ là"
    " đúng nhưng tính mol HCl bằng mol Fe (1:1) — phương trình cho thấy"
    " mol HCl = 2 × mol Fe, dẫn đến đáp số sai.'\n"
    "• 'content' phản ánh độ đúng của ĐÁP ÁN + CHUỖI LẬP LUẬN hoá học,"
    " KHÔNG độ đẹp chữ. Phương trình cân bằng sai dù tính toán đúng → 'content'"
    " KHÔNG được cao.\n"
    "• Kết quả đối soát CHỈ xuất hiện ở comment / errors — KHÔNG sửa transcript."
)


GRADER_SYSTEM_CHEM = compose_grader_system(_RULE_8_CHEM, _RULE_9_CHEM)
