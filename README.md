# VinaKIN · Marketing Command Center (bản xem thử)

Bản web tĩnh của Command Center để lãnh đạo xem tổng quan và trải nghiệm các chức năng.

- Mở `index.html` (GitHub Pages: Settings, Pages, nhánh `main`, thư mục gốc). Không cần máy chủ.
- **Toàn bộ số liệu là dữ liệu mẫu giả định**, không phải số thật của Fanpage, khách hàng hay doanh thu.
- Trang tự giả lập máy chủ trong trình duyệt. Các thao tác sau chạy được trên dữ liệu mẫu và lưu ở trình duyệt người xem (xóa dữ liệu trang để làm lại từ đầu):
  - Soạn, duyệt, kéo thả, đặt lịch bài viết, cột Chất lượng.
  - Trung tâm Chatbot: khung chat thử có kịch bản hỏi nhu cầu, khu vực, tên, liên hệ và chuyển sale; nhân viên vào chat, trả lời, ghi chú, giao việc; soạn và duyệt mẫu trả lời; nhận hoặc từ chối khách; bật tắt bot theo kênh.
  - Nối kênh (Zalo, Messenger, Google Index, Claude, Telegram, WordPress): nhập thông tin, lưu, thử, xóa. Giá trị chỉ hiện 4 ký tự cuối, không gửi đi đâu.
  - Tạo bản nháp WordPress, xếp lệnh cho A1 đến A4: ghi nhận mô phỏng.
- Không chạy được trong bản xem thử: đăng thật lên Facebook hoặc WordPress, gửi tin ra Zalo hoặc Messenger, đăng nhập Facebook, AI viết bài bằng Claude API. Các nút này báo "Bản xem thử".
- Không chứa khóa API, token, kho mã hóa hay dữ liệu khách hàng.

Bản chạy thật là `server.py` (Python) chạy riêng, có đăng nhập và kho khóa mã hóa; không đặt lên GitHub Pages.
