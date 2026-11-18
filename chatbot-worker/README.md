# chatbot-worker

Cloudflare Worker nhận `POST /chat`, gọi **Claude** (`claude-haiku-5-5`), **Gemini** hoặc **GPT**, rồi trả lời. Nằm trên nhánh `feature/chatbot`, chưa nối vào `index.html`.

## Giới hạn và bảo mật (cố định trong mã, `LIMITS` trong `src/index.js`)

| Mục | Giá trị |
|---|---|
| `max_tokens` | **400** cho cả ba nhà cung cấp (`max_tokens`, `maxOutputTokens`, `max_completion_tokens`) |
| Độ dài tin nhắn | tối đa **500 ký tự** (đếm theo ký tự, không theo byte); lịch sử tối đa 6 lượt, mỗi lượt 500 ký tự; thân yêu cầu tối đa 8 KB (quá thì 413) |
| Tốc độ | **20 tin mỗi IP mỗi giờ** (cửa sổ 1 giờ tính từ tin đầu tiên). Quá thì 429 kèm `Retry-After`. `provider: "all"` chỉ tính 1 tin nhưng tốn 3 lần gọi AI |
| CORS | chỉ nguồn trong `ALLOWED_ORIGINS`: `https://vinakin.github.io` và `https://media.vinakin.vn` (đặt ở `wrangler.toml`; mặc định trong mã nếu thiếu biến chỉ là `vinakin.github.io`). So khớp chính xác, không dùng `*`. Nguồn khác hoặc thiếu `Origin` bị 403, không có tiêu đề CORS |
| Khóa API | chỉ đọc từ biến môi trường `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`. **Không có khóa nào trong mã**; bộ kiểm thử quét mã và cấu hình để chắc điều đó |
| Lỗi nhà cung cấp | chỉ trả thông báo chung (502/503); không trả nội dung lỗi, không ghi khóa hay nội dung tin nhắn vào nhật ký |

Giới hạn tốc độ dùng **Durable Object** (`RateLimiter`, lưu bằng SQLite, dùng được trên gói Workers Free) để đếm chính xác theo từng IP; IP được băm SHA-256 trước khi làm tên đối tượng. Thiếu binding này thì Worker từ chối chạy (đóng cửa an toàn).

## Giao thức

```
POST /chat
Origin: https://vinakin.github.io
Content-Type: application/json

{ "message": "Cửa trượt có cách âm không?",
  "provider": "claude",          // tùy chọn: claude (mặc định) | gemini | gpt | all
  "history": [ {"role":"user","content":"..."}, {"role":"assistant","content":"..."} ] }   // tùy chọn, tối đa 6 lượt
```
Thành công: `{ "ok": true, "provider": "claude", "reply": "..." }` (thêm `"filtered": true` nếu câu trả lời bị bộ lọc thay). `provider: "all"` trả `{ "ok": true, "provider": "all", "replies": { "claude": {...}, "gemini": {...}, "gpt": {...} } }`, mỗi bên có `ok` riêng.
Tiêu đề trả về: `X-RateLimit-Limit`, `X-RateLimit-Remaining`.

## Ranh đỏ VinaKIN trong Worker

- Tin có **số điện thoại, email, chuỗi giống khóa** bị chặn (400) và không gửi tới nhà cung cấp (hotline công ty `0947 686 668` được phép).
- System prompt cấm giá, chiết khấu, bịa thông số, nêu đối thủ, xin thông tin khách.
- **Lọc đầu ra:** câu trả lời có số tiền, phần trăm, thông số kèm đơn vị (mm, dB, năm...), số điện thoại lạ, email hoặc liên kết bị thay bằng câu chuyển tư vấn viên. Worker không có kho tri thức để kiểm chứng nên mọi thông số bằng số đều bị coi là chưa kiểm chứng.
- **Lưu ý quan trọng:** đây là AI **trả lời trực tiếp khách công khai**, khác với Command Center (AI chỉ soạn nháp, nhân viên bấm gửi). Bộ lọc không thay được việc duyệt của người. Chưa nên đặt lên trang thật khi chưa có anh Huy và pháp chế duyệt câu chữ và cách xin đồng ý dữ liệu.

## Triển khai (anh tự làm, em không nhập khóa)

```bash
cd chatbot-worker
npm install                                   # cài wrangler
npx wrangler secret put ANTHROPIC_API_KEY     # dán khóa khi được hỏi (gõ ẩn)
npx wrangler secret put GEMINI_API_KEY        # nếu dùng provider gemini
npx wrangler secret put OPENAI_API_KEY        # nếu dùng provider gpt
# Đặt OPENAI_MODEL trong wrangler.toml (mục [vars]) bằng tên mô hình văn bản hiện hành của tài khoản OpenAI
npx wrangler deploy
```
Chạy thử cục bộ: sao `.dev.vars.example` thành `.dev.vars`, tự điền khóa, rồi `npx wrangler dev`. `.dev.vars` đã nằm trong `.gitignore`.

Thử bằng `curl` (nhớ có `Origin`, vì Worker từ chối yêu cầu không có nguồn hợp lệ):
```bash
curl -s https://<tên-worker>.<tài-khoản>.workers.dev/chat \
  -H "Origin: https://vinakin.github.io" -H "Content-Type: application/json" \
  -d '{"message":"Xin chào"}'
```

## Việc cần anh quyết hoặc xác nhận

1. **CORS và tên miền (đã xử lý):** Pages dùng tên miền riêng nên trang thật gửi `Origin: https://media.vinakin.vn`, không phải `vinakin.github.io`. Theo duyệt của anh Huy 18/11/2026, `wrangler.toml` cho phép cả hai nguồn.
2. **`OPENAI_MODEL`:** chưa xác nhận được tên mô hình GPT hiện hành, nên không có mặc định; thiếu biến này thì provider `gpt` báo chưa cấu hình.
3. **Chưa kiểm với nhà cung cấp thật:** tên mô hình Gemini (`gemini-3.8-flash`), tham số `max_completion_tokens` của OpenAI và định dạng trả về chỉ kiểm bằng giả lập.

## Kiểm thử

```bash
npm test          # node --test test/  (24 ca, không gọi mạng)
```
Kiểm: CORS (kể cả tên miền giả `vinakin.github.io.evil.com`), đúng địa chỉ, tiêu đề khóa và `max_tokens 400` của từng nhà cung cấp, giới hạn 500 ký tự và 8 KB, chặn số điện thoại và email, 20 tin mỗi IP mỗi giờ (tin 21 bị 429, IP khác độc lập, hết giờ dùng lại được), lỗi nhà cung cấp không lộ khóa, lọc đầu ra, và quét mã không chứa khóa.
