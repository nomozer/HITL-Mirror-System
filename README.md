# 📝 HITL VLM Grading Agent — "Mirror" Professional Edition

[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![React 18](https://img.shields.io/badge/React-18-61dafb.svg)](https://reactjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688.svg)](https://fastapi.tiangolo.com/)
[![Gemini VLM](https://img.shields.io/badge/Model-Gemini_Vision-orange.svg)](https://aistudio.google.com/)

**HITL VLM Grading Agent (Mirror Edition)** là hệ thống hỗ trợ chấm điểm bài tập tự luận thông minh, kết hợp sức mạnh của Vision-Language Models (VLM) và quy trình kiểm soát của con người (Human-in-the-loop).

Hệ thống đã được nâng cấp lên giao diện Chuyên nghiệp (Professional Desk) với quy trình làm việc dạng **Wizard (Trình thuật thuật)** giúp tối ưu hóa hiệu suất chấm bài của giáo viên.

---

## ✨ Điểm mới trong phiên bản Professional

- 🏗️ **Wizard Workflow (5 Bước):** Quy trình tuyến tính chuyên nghiệp: Tải lên → AI đọc bài → Giáo viên Review → Chấm lại (nếu cần) → Hoàn tất.
- 📄 **Hỗ trợ PDF & Image:** Tải lên trực tiếp tệp PDF hoặc ảnh chụp bài làm (chữ in & viết tay).
- 🔄 **Vòng lặp Chấm lại vô hạn (Iterative Re-grading):** Giáo viên có thể yêu cầu AI chấm lại nhiều lần kèm phản hồi chi tiết cho đến khi đạt kết quả mong muốn.
- 🎨 **Giao diện Modern Light:** Thiết kế tối giản, tập trung vào nội dung với hệ thống **Premium SVG Icons** đồng bộ.
- 📑 **Quản lý đa nhiệm (Tabbed Interface):** Chấm nhiều bài cùng lúc trên các Tab riêng biệt với thanh tiến trình (Progress Bar) theo dõi thời gian thực.

---

## 🔥 Quy trình 5 Bước Chuyên nghiệp

1.  **Bước 1: Tiếp nhận (Upload):** Giáo viên tải tệp (Ảnh/PDF). Hệ thống cung cấp bản xem trước trực quan.
2.  **Bước 2: Phân tích (Reading):** VLM tiến hành quét nội dung, nhận diện chữ viết và áp dụng Rubric chấm điểm.
3.  **Bước 3: Thẩm định (Review):** Giao diện tập trung hiển thị điểm số và nhận xét của AI. Giáo viên có quyền: **Duyệt**, **Yêu cầu chấm lại**, hoặc **Từ chối**.
4.  **Bước 4: Tinh chỉnh (Re-grading):** Nếu giáo viên phản hồi, AI sẽ "soi chiếu" lại bài làm và ý kiến giáo viên để đưa ra bản chấm mới chính xác hơn.
5.  **Bước 5: Lưu trữ (Done):** Kết quả cuối cùng được đóng gói chuyên nghiệp, sẵn sàng để xuất hoặc lưu.

---

## 🚀 Khởi chạy (Windows)

1.  **Cấu hình API:** Thêm `GOOGLE_API_KEY` vào `backend/.env`.
2.  **Chạy nhanh:** Kích hoạt `start_hidden.bat` tại thư mục gốc. Hệ thống sẽ tự động khởi tạo Frontend & Backend.

---

## 🛠️ Cấu trúc dự án

```text
project/
├── backend/
│   ├── agent.py               # Trung tâm điều phối Grader & Reviewer
│   ├── prompt_orchestrator.py # Quản lý logic Prompt phức tạp
│   └── main.py                # API FastAPI xử lý đa phương thức
├── frontend/
│   └── src/HITLEditor.jsx     # Giao diện Desk chấm điểm (Wizard UI)
└── start_hidden.bat           # Script khởi chạy bộ công cụ
```

---

_Dự án nghiên cứu: "Tác tử AI hỗ trợ chấm điểm tự luận đa phương thức kết hợp phản hồi từ giáo viên (Human-in-the-loop VLM Grading Agent)"._
dạy AI (Bước 4: Dạy AI), nội dung phản hồi (vd: "Chấm khắt khe hơn ở phần lập luận", "Bỏ qua lỗi chính tả nhỏ trong bài viết tay") sẽ được mô hình hóa thành một **Ràng buộc chấm điểm (Grading Constraint)**. Trong những lần chạy Pipeline sau, `PromptOrchestrator` sẽ nhận diện các bài học liên quan và ép VLM phải tuân thủ bài học đó trước khi áp dụng các quy tắc chung. Đây chính là cơ chế giúp AI "Mirror" (soi chiếu) phong cách chấm của giáo viên và không lặp lại sai lầm cũ.

---

_Phát triển cho mục đích Nghiên cứu Hệ thống Tác tử AI Sư phạm — Đề tài: "Tác tử AI hỗ trợ chấm điểm tự luận đa phương thức kết hợp phản hồi từ giáo viên (Human-in-the-loop VLM Grading Agent)"._
