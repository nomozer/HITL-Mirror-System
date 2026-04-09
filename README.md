# 🪞 HITL Mirror System — "Mirror" Edition

[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![React 18](https://img.shields.io/badge/React-18-61dafb.svg)](https://reactjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688.svg)](https://fastapi.tiangolo.com/)
[![Gemini 2.5](https://img.shields.io/badge/Model-Gemini_2.5_Flash-orange.svg)](https://aistudio.google.com/)

**HITL Mirror** là hệ thống nghiên cứu lập trình theo cơ chế **Human-in-the-Loop**. Phiên bản "Mirror" tập trung vào việc tạo ra một vòng lặp tự học giữa AI và Con người, nơi AI không chỉ viết code mà còn "soi mình" qua các bài học được lưu trữ trong bộ nhớ Vector.

---

## 🔥 Kiến trúc Prompt hiện đại

Dự án sử dụng cơ chế **Cấu trúc Prompt Phân lớp (Layered Prompting)** thông qua module `PromptOrchestrator`:

1.  **🚀 Fixed System Instructions (Prompt Cố định):**
    *   Định nghĩa vai trò Kỹ sư cấp cao (Senior Engineer) và Người kiểm duyệt (Critic).
    *   Áp đặt các tiêu chuẩn kỹ thuật bất biến: PEP 8, xử lý ngoại lệ, và phong cách viết súc tích.
    *   **Mục tiêu:** Giữ cho AI luôn hoạt động đúng chuẩn mực chuyên gia.

2.  **🧠 Dynamic Memory Context (Prompt Động):**
    *   **HITL Priority Constraints:** Các bài học thực tế từ con người được truy xuất từ ChromaDB và đẩy vào prompt như những ràng buộc có ưu tiên cao nhất.
    *   **Context Injection:** Nhiệm vụ hiện tại và mã nguồn phản hồi được bao bọc trong các Header có cấu trúc để AI dễ dàng phân tích.

---

## ✨ Tính năng nổi bật

- 🌍 **Song ngữ hoàn toàn (Bilingual):** Hỗ trợ Tiếng Anh và Tiếng Việt cho cả giao diện và tư duy của AI.
- ⚡ **Súc tích & Trực tiếp:** AI Critic được tinh chỉnh để bỏ qua lời chào xã giao, tập trung 100% vào lỗi kỹ thuật trong không quá 20 từ mỗi lỗi.
- 🛠️ **Bộ nhớ kép (Dual Memory):** Kết hợp SQLite (Dữ liệu cấu trúc) và ChromaDB (Bộ nhớ cảm ngữ cảnh).
- 🔌 **Heartbeat Auto-shutdown:** Tự động tắt Backend khi không có tín hiệu từ Browser sau 60s.

---

## 🚀 Khởi chạy (Windows)

1. **API Key:** Cấu hình trong `backend/.env`.
2. **One-click Start:** Chạy file `start_hidden.bat` ở thư mục gốc. Hệ thống sẽ tự động mở tại `http://localhost:3000`.

---

## 🛠️ Cấu trúc Module

```text
project/
├── backend/
│   ├── prompt_orchestrator.py # [NEW] Trái tim của hệ thống Prompt
│   ├── agent.py               # Điều phối luồng Coder → Critic
│   ├── memory.py              # Quản lý bộ nhớ SQLite & Vector
│   ├── main.py                # FastAPI endpoints
│   └── data/                  # Cơ sở dữ liệu article & lessons
├── frontend/
│   └── src/HITLEditor.jsx     # Giao diện Mirror hiện đại
└── start_hidden.bat           # Script khởi chạy nhanh
```

---

## 📖 Cách hệ thống học hỏi

Khi bạn dạy AI (Bước 4: Dạy AI), nội dung bài học sẽ được mô hình hóa thành một **Ràng buộc (Constraint)**. Trong những lần chạy Pipeline sau, `PromptOrchestrator` sẽ nhận diện các bài học liên quan và ép AI phải tuân thủ bài học đó trước khi áp dụng các quy tắc chung. Đây chính là cơ chế giúp AI "Mirror" (soi chiếu) và không lặp lại sai lầm cũ.

---
*Phát triển cho mục đích Nghiên cứu Hệ thống Lập trình Agentic.*
