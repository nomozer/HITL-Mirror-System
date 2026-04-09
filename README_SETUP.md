# ⚙️ HITL Mirror — Hướng dẫn cài đặt kỹ thuật (Technical Setup)

Tài liệu này hướng dẫn chi tiết cách thiết lập môi trường để chạy hệ thống **HITL Mirror**.

---

## 📋 Yêu cầu hệ thống (Prerequisites)

- **Python 3.11+**: [Tải về tại đây](https://www.python.org/downloads/)
- **Node.js 18+**: [Tải về tại đây](https://nodejs.org/)
- **Google Gemini API Key**: [Lấy key miễn phí tại Google AI Studio](https://aistudio.google.com/apikey)

---

## ⚡ 1. Cách chạy nhanh (Khuyên dùng)

Nếu bạn đã cài đặt Python và Node.js, bạn chỉ cần thực hiện 2 bước sau:

1.  Mở file `backend/.env` và thay đổi `GOOGLE_API_KEY` của bạn.
2.  Chạy file `start_hidden.bat` ở thư mục gốc.

*Hệ thống sẽ tự động cài đặt các thư viện cần thiết lần đầu tiên và khởi chạy cả Backend & Frontend.*

---

## 🛠️ 2. Thiết lập thủ công (Từng bước)

Nếu bạn muốn kiểm soát từng bước hoặc gặp lỗi khi chạy script, hãy làm theo hướng dẫn này:

### Bước 2.1: Cấu hình Backend
1. Mở terminal tại thư mục `backend/`.
2. Tạo môi trường ảo: `python -m venv venv`.
3. Kích hoạt môi trường: `venv\Scripts\activate`.
4. Cài đặt thư viện: `pip install -r requirements.txt`.
5. Sau khi cấu hình `.env`, chạy server: `uvicorn main:app --reload --port 8000`.

### Bước 2.2: Cấu hình Frontend
1. Mở một terminal mới tại thư mục `frontend/`.
2. Cài đặt dependencies: `npm install`.
3. Chạy ứng dụng: `npm start`.

---

## 🔐 3. Cấu hình biến môi trường (.env)

Vị trí: `backend/.env`

```ini
# Google Gemini API Key (Bắt buộc)
GOOGLE_API_KEY=your_gemini_api_key_here

# Model Configuration
GEMINI_MODEL=gemini-2.5-flash

# CORS Settings (Mặc định cho local dev)
CORS_ORIGINS=http://localhost:3000
```

---

## 🔍 4. Xử lý sự cố (Troubleshooting)

- **Lỗi cổng 8000 hoặc 3000 đã bị sử dụng:**
  Đôi khi server cũ không tắt hoàn toàn, bạn có thể chạy lệnh này trong PowerShell để giải phóng cổng:
  ```powershell
  Get-NetTCPConnection -LocalPort 8000,3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```

- **Không nhận diện được Gemini API Key:**
  Hãy đảm bảo bạn không có dấu cách thừa trong file `.env` và đã lưu file.

- **Frontend không hiển thị dữ liệu:**
  Kiểm tra terminal backend xem có thông báo lỗi `404` hay không. Đảm bảo Backend đang chạy tại port `8000`.

---

## 🛑 5. Cách dừng hệ thống

Hệ thống tích hợp sẵn cơ chế **Heartbeat**:
- Chỉ cần đóng trình duyệt.
- Backend sẽ tự động tắt sau **60 giây** để giải phóng RAM và CPU.

---
*Nếu gặp bất kỳ khó khăn nào, hãy kiểm tra logs trong cửa sổ terminal.*
