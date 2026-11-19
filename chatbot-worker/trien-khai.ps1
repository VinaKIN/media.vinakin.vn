# trien-khai.ps1: triển khai chatbot-worker lên Cloudflare bằng API token, nhập khóa bằng ô ẩn.
# - Token và khóa KHÔNG hiện trên màn hình, KHÔNG lưu vào tệp, KHÔNG ghi vào lịch sử lệnh. Token chỉ tồn tại trong cửa sổ này.
# - Chạy từng bước và hỏi lại trước khi làm việc có ảnh hưởng (deploy, đặt khóa).
# Chạy: powershell -ExecutionPolicy Bypass -File .\trien-khai.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Read-Secret([string]$prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Clean([string]$v) { return $v.Trim().Trim('"').Trim("'").Trim() }

Write-Host '== Bước 1: API token Cloudflare ==' -ForegroundColor Cyan
Write-Host 'Tạo token tại https://dash.cloudflare.com/profile/api-tokens (Create Token, mẫu "Edit Cloudflare Workers").'
$token = ''
# Ưu tiên lấy từ khay nhớ tạm (sau khi bấm "Copy to clipboard" ở trang Cloudflare): chỉ hiện độ dài, không hiện token.
$clip = ''
try { $clip = Clean ((Get-Clipboard -Raw) -as [string]) } catch { $clip = '' }
if ($clip -match '^[A-Za-z0-9_\-]{35,80}$') {
  Write-Host ("Khay nhớ tạm có một chuỗi dài {0} ký tự đúng dạng token Cloudflare (không hiển thị)." -f $clip.Length) -ForegroundColor Yellow
  $use = Read-Host 'Enter để dùng chuỗi này, hoặc gõ N rồi Enter để tự dán token khác'
  if ($use -notmatch '^[Nn]') { $token = $clip }
}
$clip = $null
if (-not $token) { $token = Clean (Read-Secret 'Dán API token, rồi Enter (không hiện chữ, dán xong cứ Enter)') }
if ($token.Length -lt 20 -or $token -match '\s') { throw ("Token sai dạng (dài {0} ký tự, quá ngắn hoặc có dấu cách). Không làm gì." -f $token.Length) }
Write-Host ("Đã nhận token dài {0} ký tự." -f $token.Length) -ForegroundColor Green
$env:CLOUDFLARE_API_TOKEN = $token

Write-Host ''
Write-Host '== Bước 2: kiểm tra token ==' -ForegroundColor Cyan
& npx.cmd wrangler whoami
if ($LASTEXITCODE -ne 0) { throw 'Token chưa dùng được. Kiểm tra quyền "Edit Cloudflare Workers" và thử lại.' }

Write-Host ''
Write-Host '== Bước 3: deploy Worker ==' -ForegroundColor Cyan
Write-Host 'Deploy tạo Worker "vinakin-chatbot" công khai trên Cloudflare (địa chỉ *.workers.dev). Chưa có khóa AI thì Worker trả lỗi 503, không gọi AI nào.'
$go = Read-Host 'Gõ DEPLOY để deploy, hoặc KHOA để bỏ qua deploy và chỉ đặt lại khóa AI (Enter trống để dừng)'
if ($go -cne 'DEPLOY' -and $go -cne 'KHOA') { Write-Host 'Đã dừng, chưa làm gì.'; return }
if ($go -ceq 'DEPLOY') {
  & npx.cmd wrangler deploy
  if ($LASTEXITCODE -ne 0) { throw 'Deploy lỗi. Chép dòng lỗi gửi cho trợ lý (không gửi token).' }
} else { Write-Host 'Bỏ qua deploy, chỉ đặt khóa.' }

Write-Host ''
Write-Host '== Bước 4: đặt khóa AI cho Worker (mỗi khóa Enter trống để bỏ qua) ==' -ForegroundColor Cyan
foreach ($name in 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY') {
  $v = Clean (Read-Secret "Dán $name (Enter trống để bỏ qua)")
  if ($v) {
    $v | & npx.cmd wrangler secret put $name
    if ($LASTEXITCODE -ne 0) { Write-Host "Không đặt được $name" -ForegroundColor Red } else { Write-Host "Đã đặt $name" -ForegroundColor Green }
  } else { Write-Host "Bỏ qua $name" }
}
Write-Host ''
Write-Host '== Bước 5: khóa CÔNG KHAI Supabase cho kho catalog (không bắt buộc) ==' -ForegroundColor Cyan
Write-Host 'Khóa công khai (sb_publishable_...) chỉ gọi được hàm match_catalog, không đọc được bảng. Vào Supabase > project pdf-chatbot-thu > Settings > API Keys,'
Write-Host 'bấm Copy ở mục "Publishable key", rồi nhấn Enter tại đây. Enter ngay (không copy) để bỏ qua.'
[void](Read-Host 'Enter')
$pub = ''
try { $pub = Clean ((Get-Clipboard -Raw) -as [string]) } catch { $pub = '' }
if ($pub -match '^sb_publishable_\S{20,}$') {
  $pub | & npx.cmd wrangler secret put SUPABASE_PUBLISHABLE_KEY
  if ($LASTEXITCODE -ne 0) { Write-Host 'Không đặt được SUPABASE_PUBLISHABLE_KEY' -ForegroundColor Red } else { Write-Host 'Đã đặt SUPABASE_PUBLISHABLE_KEY' -ForegroundColor Green }
} else { Write-Host 'Khay nhớ tạm không có khóa công khai Supabase, bỏ qua (chatbot trả lời như cũ, chưa có catalog).' }
$pub = $null
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
Write-Host ''
Write-Host 'Xong. Chép địa chỉ https://vinakin-chatbot....workers.dev trong phần deploy ở trên gửi cho trợ lý (địa chỉ không bí mật).' -ForegroundColor Green
