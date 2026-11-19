# thu-gemini.ps1: thử khóa Gemini trực tiếp với Google (không qua Worker) để biết vì sao Worker báo lỗi.
# Khóa nhập bằng ô ẩn, chỉ dùng cho hai lần gọi tới generativelanguage.googleapis.com, không lưu, không in ra.
# Chạy: powershell -ExecutionPolicy Bypass -File .\thu-gemini.ps1
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Read-Secret([string]$prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Call([string]$method, [string]$url, [string]$key, [string]$body) {
  try {
    $p = @{ Uri = $url; Method = $method; Headers = @{ 'x-goog-api-key' = $key }; UseBasicParsing = $true; TimeoutSec = 60 }
    if ($body) { $p.Body = [Text.Encoding]::UTF8.GetBytes($body); $p.ContentType = 'application/json; charset=utf-8' }
    $r = Invoke-WebRequest @p
    return @{ Status = [int]$r.StatusCode; Body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    $txt = ''
    if ($resp) { try { $sr = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8); $txt = $sr.ReadToEnd() } catch {} }
    $code = 0; if ($resp) { $code = [int]$resp.StatusCode }
    return @{ Status = $code; Body = $txt }
  }
}

$key = (Read-Secret 'Dán khóa Gemini (AQ.... hoặc AIza...), rồi Enter (không hiện chữ)').Trim().Trim('"').Trim("'")
if ($key -notmatch '^(AIza|AQ\.)\S{20,}$') { throw 'Khóa sai dạng (phải bắt đầu bằng AQ. hoặc AIza, liền một chuỗi, không dấu cách). Không gọi gì.' }

Write-Host ''
Write-Host '== 1. Danh sách mô hình khóa này dùng được (lọc "flash") ==' -ForegroundColor Cyan
$m = Call 'GET' 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200' $key ''
Write-Host ("HTTP {0}" -f $m.Status)
if ($m.Status -eq 200) {
  $names = ([regex]::Matches($m.Body, '"name":\s*"models/([^"]+)"') | ForEach-Object { $_.Groups[1].Value }) | Where-Object { $_ -match 'flash' } | Sort-Object -Unique
  if ($names) { $names | ForEach-Object { Write-Host "  $_" } } else { Write-Host '  (không thấy mô hình flash nào)' }
} else {
  $e = $m.Body; if ($e.Length -gt 600) { $e = $e.Substring(0, 600) }
  Write-Host $e
}

Write-Host ''
Write-Host '== 2. Thử gọi gemini-3.8-flash như Worker (có systemInstruction, maxOutputTokens 400) ==' -ForegroundColor Cyan
$body = '{"systemInstruction":{"parts":[{"text":"Bạn là trợ lý ngắn gọn."}]},"contents":[{"role":"user","parts":[{"text":"Xin chào"}]}],"generationConfig":{"maxOutputTokens":400}}'
$g = Call 'POST' 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent' $key $body
Write-Host ("HTTP {0}" -f $g.Status)
$t = $g.Body; if ($t.Length -gt 800) { $t = $t.Substring(0, 800) }
Write-Host $t
Write-Host ''
Write-Host 'Chép kết quả hai phần trên gửi trợ lý (khóa không nằm trong kết quả).' -ForegroundColor Green
