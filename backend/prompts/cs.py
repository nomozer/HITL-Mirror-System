"""
prompts/cs.py — Tin học-specific prompt content.

Provides Rule 8 (calibration examples) + Rule 9 (code trace crosscheck)
for CS grading. The rest of the prompt (Rules 1–7, 9b anchors, persona,
rubric) is shared via ``prompts.base``.

Upgrade tips:
  - Add calibration examples tied to concrete bug categories you see
    repeatedly (off-by-one, edge cases, type errors, wrong complexity).
  - Add bullets to _RULE_9_CS as new pitfalls emerge during HITL reviews.
"""

from __future__ import annotations

from .base import compose_grader_system


_RULE_8_CS = (
    "8. VÍ DỤ HIỆU CHỈNH (KHÔNG chép các ví dụ này vào transcript):\n\n"
    "— CHÉP TRANSCRIPT —\n"
    "• Code học sinh viết: chép y nguyên thụt lề, dấu chấm phẩy, tên biến "
    "(kể cả typo). 'prnit()' CHÉP là 'prnit()', KHÔNG 'sửa' thành 'print()'.\n"
    "• Số nhị phân / hex: '1111101 + 10001 = 10001110' chép đúng vậy, "
    "KHÔNG tính lại. Nhãn 'a)', 'b)' phải xuất hiện.\n"
    "• Bài ≥5 dòng code/câu: chép TOÀN BỘ — dừng sớm là thất bại nghiêm "
    "trọng. Khối code phải giữ thụt lề 4-space thật (Python).\n\n"
    "— CHẤM ĐIỂM TIN HỌC (calibrate) —\n"
    "• Code chạy ra đúng output mẫu nhưng thiếu xử lý input rỗng / n=0: "
    "content=7.0, argument=7.0, expression=7.5, creativity=5.0 → overall=6.5.\n"
    "• Thuật toán đúng nhưng O(n²) khi đề yêu cầu O(n log n): content=7.5, "
    "argument=5.0, expression=6.5, creativity=4.0 → overall=5.5.\n"
    "• Pseudo-code logic đúng, cú pháp lộn xộn (thiếu khai báo kiểu, thụt "
    "lề sai): content=7.5, argument=7.5, expression=4.0, creativity=5.5 → "
    "overall=6.0.\n"
    "• Sai off-by-one (for i in range(n) thay range(n+1)) làm mất phần tử "
    "cuối: content=5.0, argument=7.0, expression=7.0, creativity=4.5 → "
    "overall=5.5.\n"
    "• Code đúng nhưng KHÔNG giải thích vì sao chọn cấu trúc dữ liệu này: "
    "content=8.0, argument=7.5, expression=7.5, creativity=4.5 → overall=7.0."
)


_RULE_9_CS = (
    "9. ĐỐI SOÁT LOGIC (TIN HỌC):\n"
    "• Trace mentally từng dòng code với test case trong đề: biến nào thay "
    "đổi, điều kiện rẽ nhánh ra true/false lúc nào, vòng lặp chạy bao nhiêu "
    "iteration, output cuối là gì.\n"
    "• Quét các lỗi code phổ biến:\n"
    "  - off-by-one (range(n) vs range(n+1), < vs <=)\n"
    "  - sai điều kiện dừng vòng lặp (infinite loop, exit sớm)\n"
    "  - quên edge case: mảng rỗng, n=0 hoặc n=1, số âm, chia cho 0, "
    "overflow\n"
    "  - sai kiểu dữ liệu: int vs float, string vs int, truncate khi chia\n"
    "  - biến chưa khởi tạo, dùng biến ngoài scope, shadow variable\n"
    "  - tham chiếu ngược (off-by-one ở index cuối), mutable default args\n"
    "• Kiểm tra tính đúng đắn thuật toán: trả đúng output mẫu trong đề? "
    "Corner case xử lý? Độ phức tạp phù hợp yêu cầu đề? (vd: đề yêu cầu "
    "O(n log n), học sinh nộp O(n²) → phải trừ argument).\n"
    "• Với pseudo-code: chấp nhận cú pháp phi-chuẩn miễn logic rõ. KHÔNG "
    "phạt vì thiếu kiểu dữ liệu (Python không yêu cầu), miễn biến được "
    "dùng consistent.\n"
    "• Lỗi code PHẢI ghi RÕ: tên biến / dòng / loại lỗi. Vd: 'Dòng for i "
    "in range(n) nên là range(n+1) — vòng lặp dừng ở i=n-1, bỏ sót phần "
    "tử cuối của mảng a[n].' 'Biến count chưa khởi tạo = 0 trước vòng lặp, "
    "có thể gây NameError.'\n"
    "• 'content' phản ánh độ đúng của OUTPUT + logic code, KHÔNG độ đẹp "
    "cú pháp. Code sai output KHÔNG được 'content' cao dù trình bày đẹp.\n"
    "• Kết quả đối soát CHỈ xuất hiện ở comment / errors — KHÔNG sửa transcript."
)


GRADER_SYSTEM_CS = compose_grader_system(_RULE_8_CS, _RULE_9_CS)
