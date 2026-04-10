# ⚙️ HITL Mirror — Hướng dẫn cài đặt kỹ thuật (Technical Setup)

Tài liệu này hướng dẫn chi tiết cách thiết lập môi trường để vận hành hệ thống **HITL Mirror Professional Edition**.

---

## 📋 Yêu cầu hệ thống (Prerequisites)

- **Python 3.11+**: Đảm bảo đã thêm vào PATH. [Tải về](https://www.python.org/downloads/)
- **Node.js 18+**: Cần thiết để chạy giao diện React. [Tải về](https://nodejs.org/)
- **Google Gemini API Key**: Yêu cầu quyền truy cập mô hình Vision (1.5 Flash hoặc 1.5 Pro). [Lấy key miễn phí](https://aistudio.google.com/apikey)

---

## ⚡ 1. Khởi chạy nhanh (Recommended)

Hệ thống được thiết kế để tự động hóa tối đa quy trình cài đặt.

1.  **Cấu hình API:** Sao chép file `backend/.env.example` thành `backend/.env` (nếu có) hoặc chỉnh sửa trực tiếp `backend/.env`. Điền Key của bạn vào:
    `GOOGLE_API_KEY=your_key_here`
2.  **Kích hoạt:** Chạy file `start_hidden.bat` tại thư mục gốc.

*Hệ thống sẽ tự động tạo Virtual Environment cho Python, cài đặt thư viện cho cả Backend & Frontend, sau đó mở trình duyệt tại `http://localhost:3000`.*

---

## 🛠️ 2. Thiết lập thủ công (Manual Setup)

Dành cho các nhà phát triển muốn can thiệp sâu hoặc gỡ lỗi:

### Bước 2.1: Backend (FastAPI)
- `cd backend`
- `python -m venv venv`
- `.\venv\Scripts\activate` (Windows)
- `pip install -r requirements.txt`
- `uvicorn main:app --reload --port 8000`

### Bước 2.2: Frontend (React)
- `cd frontend`
- `npm install`
- `npm start`

---

## 🔍 3. Xử lý sự cố (Troubleshooting)

- **Lỗi Multimodal (Ảnh/PDF):** Đảm bảo API Key của bạn hỗ trợ mô hình Gemini 1.5. Nếu tệp PDF quá lớn, hãy thử giảm số trang hoặc dung lượng.
- **Lỗi cổng (Port Conflict):** Nếu port 8000 hoặc 3000 bị chiếm dụng, hãy chạy lệnh sau trong PowerShell để giải phóng:
  ```powershell
  Get-NetTCPConnection -LocalPort 8000,3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
- **Lỗi Vite/NPM:** Nếu Frontend không khởi động, hãy xóa thư mục `node_modules` và chạy lại `npm install`.

---

## 🛑 4. Cơ chế Quản lý Tài nguyên (Heartbeat)

Để tiết kiệm RAM/CPU và chi phí API, hệ thống tích hợp sẵn cơ chế **Tự động tắt**:
- Backend sẽ lắng nghe tín hiệu từ Frontend (Heartbeat) mỗi 30 giây.
- **Khi đóng tab trình duyệt:** Backend sẽ tự động phát hiện và kết thúc toàn bộ tiến trình sau **30-60 giây**.
- Bạn không cần phải thủ công tắt cửa sổ Terminal.

---
*Tài liệu hướng dẫn vận hành kỹ thuật — Đội ngũ phát triển Antigravity.*
