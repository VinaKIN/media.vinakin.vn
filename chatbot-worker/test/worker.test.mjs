// Chạy: node --test test/   (Node 20 trở lên). Không gọi mạng thật: fetch tới nhà cung cấp được giả lập.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { RateLimiter, LIMITS, validate, buildTurns, guardReply } from "../src/index.js";

const ORIGIN = "https://vinakin.github.io";
const HERE = dirname(fileURLToPath(import.meta.url));
// Khóa thử có đủ dạng để kiểm tra rò rỉ, nhưng chỉ tồn tại trong bộ kiểm thử này.
const KEYS = { ANTHROPIC_API_KEY: "test-anthropic-key-0001", GEMINI_API_KEY: "test-gemini-key-0002", OPENAI_API_KEY: "test-openai-key-0003" };

function makeNs() {
  const objs = new Map();
  return {
    idFromName: (n) => n,
    get(id) {
      if (!objs.has(id)) {
        const store = new Map();
        const state = { storage: { get: async (k) => store.get(k), put: async (k, v) => void store.set(k, v), setAlarm: async () => {}, deleteAll: async () => store.clear() } };
        objs.set(id, new RateLimiter(state));
      }
      const o = objs.get(id);
      return { fetch: (url, init) => o.fetch(new Request(url, init)) };
    },
  };
}
const makeEnv = (extra = {}) => ({ ...KEYS, OPENAI_MODEL: "test-gpt", RATE_LIMITER: makeNs(), ...extra });

const realFetch = globalThis.fetch;
let calls = [];
let upstream = {};
function mockUpstream() {
  calls = [];
  upstream = {
    claude: () => ({ status: 200, body: { content: [{ type: "text", text: "Dạ, em xin chào anh/chị ạ." }] } }),
    gemini: () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: "Dạ, em xin chào anh/chị ạ." }] } }] } }),
    gpt: () => ({ status: 200, body: { choices: [{ message: { content: "Dạ, em xin chào anh/chị ạ." } }] } }),
  };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const name = u.includes("anthropic") ? "claude" : u.includes("googleapis") ? "gemini" : u.includes("openai") ? "gpt" : null;
    assert.ok(name, "yêu cầu ra ngoài tới địa chỉ lạ: " + u);
    calls.push({ name, url: u, headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) });
    const r = upstream[name]();
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
}
test.beforeEach(mockUpstream);
test.after(() => { globalThis.fetch = realFetch; });

function post(body, { env = makeEnv(), origin = ORIGIN, ip = "203.0.113.5", raw } = {}) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": ip };
  if (origin) headers.Origin = origin;
  return worker.fetch(new Request("https://w.example/chat", { method: "POST", headers, body: raw ?? JSON.stringify(body) }), env);
}

// ── CORS và định tuyến ──
test("preflight từ vinakin.github.io được phép, kèm đúng tiêu đề CORS", async () => {
  const r = await worker.fetch(new Request("https://w.example/chat", { method: "OPTIONS", headers: { Origin: ORIGIN } }), makeEnv());
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(r.headers.get("Access-Control-Allow-Methods"), /POST/);
  assert.equal(r.headers.get("Vary"), "Origin");
});
test("nguồn khác, giả mạo tên miền, hoặc không có Origin bị từ chối 403 và không có tiêu đề CORS", async () => {
  for (const origin of ["https://evil.example", "https://vinakin.github.io.evil.com", "http://vinakin.github.io", "https://media.vinakin.vn", null]) {
    const pre = await worker.fetch(new Request("https://w.example/chat", { method: "OPTIONS", headers: origin ? { Origin: origin } : {} }), makeEnv());
    assert.equal(pre.status, 403, "preflight " + origin);
    assert.equal(pre.headers.get("Access-Control-Allow-Origin"), null);
    const r = await post({ message: "xin chào" }, { origin });
    assert.equal(r.status, 403, "POST " + origin);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
  }
  assert.equal(calls.length, 0, "không được gọi nhà cung cấp khi bị từ chối");
});
test("ALLOWED_ORIGINS đặt được nhiều nguồn, so khớp chính xác", async () => {
  const env = makeEnv({ ALLOWED_ORIGINS: "https://vinakin.github.io, https://media.vinakin.vn/" });
  assert.equal((await post({ message: "xin chào" }, { env, origin: "https://media.vinakin.vn" })).status, 200);
  assert.equal((await post({ message: "xin chào" }, { env, origin: "https://media.vinakin.vn.evil.com" })).status, 403);
});
test("wrangler.toml cho phép đúng hai nguồn (vinakin.github.io và media.vinakin.vn), không có dấu *", () => {
  const toml = readFileSync(join(HERE, "..", "wrangler.toml"), "utf8");
  const m = /^ALLOWED_ORIGINS\s*=\s*"([^"]*)"/m.exec(toml);
  assert.ok(m, "thiếu ALLOWED_ORIGINS");
  assert.deepEqual(m[1].split(",").map((s) => s.trim()), ["https://vinakin.github.io", "https://media.vinakin.vn"]);
  assert.ok(!m[1].includes("*"));
});
test("đường dẫn và phương thức sai", async () => {
  const a = await worker.fetch(new Request("https://w.example/khac", { method: "POST", headers: { Origin: ORIGIN } }), makeEnv());
  assert.equal(a.status, 404);
  const g = await worker.fetch(new Request("https://w.example/chat", { method: "GET", headers: { Origin: ORIGIN } }), makeEnv());
  assert.equal(g.status, 405);
  assert.match(g.headers.get("Allow"), /POST/);
});

// ── gọi nhà cung cấp ──
test("Claude: đúng địa chỉ, khóa lấy từ biến môi trường, mô hình claude-haiku-5-5, max_tokens 400", async () => {
  const r = await post({ message: "Cửa cách âm có tốt không?" });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual([j.ok, j.provider, j.reply], [true, "claude", "Dạ, em xin chào anh/chị ạ."]);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const c = calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.headers["x-api-key"], KEYS.ANTHROPIC_API_KEY);
  assert.equal(c.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.body.model, "claude-haiku-5-5");
  assert.equal(c.body.max_tokens, 400);
  assert.match(c.body.system, /RANH ĐỎ/);
  assert.deepEqual(c.body.messages, [{ role: "user", content: "Cửa cách âm có tốt không?" }]);
});
test("Gemini: khóa trong tiêu đề (không qua URL), maxOutputTokens 400", async () => {
  const j = await (await post({ message: "xin chào", provider: "gemini" })).json();
  assert.equal(j.reply, "Dạ, em xin chào anh/chị ạ.");
  const c = calls[0];
  assert.match(c.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(c.headers["x-goog-api-key"], KEYS.GEMINI_API_KEY);
  assert.ok(!c.url.includes(KEYS.GEMINI_API_KEY));
  assert.equal(c.body.generationConfig.maxOutputTokens, 400);
  assert.ok(c.body.systemInstruction.parts[0].text.length > 50);
});
test("GPT: Bearer lấy từ biến môi trường, max_completion_tokens 400, mô hình lấy từ OPENAI_MODEL", async () => {
  const j = await (await post({ message: "xin chào", provider: "gpt" })).json();
  assert.equal(j.reply, "Dạ, em xin chào anh/chị ạ.");
  const c = calls[0];
  assert.equal(c.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(c.headers.authorization, "Bearer " + KEYS.OPENAI_API_KEY);
  assert.equal(c.body.model, "test-gpt");
  assert.equal(c.body.max_completion_tokens, 400);
  assert.equal(c.body.messages[0].role, "system");
});
test("GPT thiếu OPENAI_MODEL thì báo chưa cấu hình, không đoán tên mô hình", async () => {
  const env = makeEnv(); delete env.OPENAI_MODEL;
  const r = await post({ message: "xin chào", provider: "gpt" }, { env });
  assert.equal(r.status, 503);
  assert.equal(calls.length, 0);
});
test("provider all gọi song song cả ba, một bên lỗi không làm hỏng hai bên còn lại", async () => {
  upstream.gemini = () => ({ status: 500, body: { error: { message: "chi tiết nội bộ KHONG_DUOC_LO " + KEYS.GEMINI_API_KEY } } });
  const r = await post({ message: "xin chào", provider: "all" });
  const text = await r.text(); const j = JSON.parse(text);
  assert.equal(r.status, 200);
  assert.equal(j.replies.claude.ok, true); assert.equal(j.replies.gpt.ok, true); assert.equal(j.replies.gemini.ok, false);
  assert.equal(calls.length, 3);
  assert.ok(!text.includes("KHONG_DUOC_LO") && !text.includes(KEYS.GEMINI_API_KEY), "không được lộ nội dung lỗi hay khóa");
});
test("lịch sử được gộp xen kẽ user/assistant, bắt đầu bằng user", async () => {
  await post({ message: "còn Romadio thì sao?", history: [{ role: "assistant", content: "Dạ chào anh/chị ạ." }, { role: "user", content: "Ponzio cách âm tốt không?" }, { role: "assistant", content: "Dạ em xin phép tư vấn ạ." }] });
  assert.deepEqual(calls[0].body.messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(buildTurns([{ role: "user", content: "a" }], "b"), [{ role: "user", content: "a\nb" }]);
});

// ── lỗi nhà cung cấp và cấu hình ──
test("thiếu ANTHROPIC_API_KEY: 503, không gọi ra ngoài", async () => {
  const env = makeEnv(); delete env.ANTHROPIC_API_KEY;
  const r = await post({ message: "xin chào" }, { env });
  assert.equal(r.status, 503); assert.equal(calls.length, 0);
});
test("nhà cung cấp trả 401 hay lỗi: trả 502 chung chung, không lộ nội dung hay khóa", async () => {
  upstream.claude = () => ({ status: 401, body: { error: { message: "invalid x-api-key " + KEYS.ANTHROPIC_API_KEY } } });
  const r = await post({ message: "xin chào" }); const t = await r.text();
  assert.equal(r.status, 502);
  assert.ok(!t.includes(KEYS.ANTHROPIC_API_KEY) && !t.includes("invalid x-api-key"));
});
test("Gemini quá tải (503): thử mô hình dự phòng một lần và trả lời được; lỗi cuối có mã upstream", async () => {
  const env = makeEnv({ GEMINI_FALLBACK_MODEL: "gemini-flash-lite-latest" });
  let n = 0;
  upstream.gemini = () => (++n === 1 ? { status: 503, body: { error: { message: "high demand KHONG_DUOC_LO" } } } : { status: 200, body: { candidates: [{ content: { parts: [{ text: "Dạ, em xin chào anh/chị ạ." }] } }] } });
  const j = await (await post({ message: "xin chào", provider: "gemini" }, { env })).json();
  assert.equal(j.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /models\/gemini-3\.8-flash:/);
  assert.match(calls[1].url, /models\/gemini-flash-lite-latest:/);
  // cả hai đều 503: dừng ở 2 yêu cầu, trả 502 kèm upstream 503, không lộ nội dung lỗi
  calls.length = 0; upstream.gemini = () => ({ status: 503, body: { error: { message: "high demand KHONG_DUOC_LO" } } });
  const r = await post({ message: "xin chào", provider: "gemini" }, { env: makeEnv({ GEMINI_FALLBACK_MODEL: "gemini-flash-lite-latest" }) });
  const t = await r.text();
  assert.equal(r.status, 502); assert.equal(calls.length, 2);
  assert.equal(JSON.parse(t).upstream, 503);
  assert.match(JSON.parse(t).error, /quá tải/);
  assert.ok(!t.includes("KHONG_DUOC_LO"));
});
test("Gemini lỗi không tạm thời (400, 401, 403, 404) thì KHÔNG thử lại; không có mô hình dự phòng thì chỉ 1 yêu cầu", async () => {
  for (const code of [400, 401, 403, 404]) {
    calls.length = 0; upstream.gemini = () => ({ status: code, body: { error: {} } });
    const r = await post({ message: "xin chào", provider: "gemini" }, { env: makeEnv({ GEMINI_FALLBACK_MODEL: "gemini-flash-lite-latest" }) });
    assert.equal(r.status, 502, String(code)); assert.equal(calls.length, 1, "mã " + code); assert.equal((await r.json()).upstream, code);
  }
  calls.length = 0; upstream.gemini = () => ({ status: 503, body: {} });
  await post({ message: "xin chào", provider: "gemini" });
  assert.equal(calls.length, 1, "không đặt GEMINI_FALLBACK_MODEL thì không thử lại");
});
test("khóa có xuống dòng hoặc dấu cách thừa vẫn được cắt sạch trước khi gửi (CRLF do ống lệnh PowerShell)", async () => {
  const env = makeEnv({ GEMINI_API_KEY: "  " + KEYS.GEMINI_API_KEY + "\r\n", ANTHROPIC_API_KEY: KEYS.ANTHROPIC_API_KEY + "\r\n", OPENAI_API_KEY: KEYS.OPENAI_API_KEY + "\n" });
  await post({ message: "xin chào", provider: "gemini" }, { env });
  await post({ message: "xin chào", provider: "claude" }, { env });
  await post({ message: "xin chào", provider: "gpt" }, { env });
  assert.equal(calls[0].headers["x-goog-api-key"], KEYS.GEMINI_API_KEY);
  assert.equal(calls[1].headers["x-api-key"], KEYS.ANTHROPIC_API_KEY);
  assert.equal(calls[2].headers.authorization, "Bearer " + KEYS.OPENAI_API_KEY);
  // khóa chỉ gồm khoảng trắng thì coi là chưa cấu hình
  const e2 = makeEnv({ GEMINI_API_KEY: " \r\n" });
  assert.equal((await post({ message: "xin chào", provider: "gemini" }, { env: e2 })).status, 503);
});
test("lỗi nhà cung cấp kèm mã lý do an toàn (reason), không kèm nội dung lỗi", async () => {
  upstream.gemini = () => ({ status: 400, body: { error: { code: 400, message: "API key not valid KHONG_DUOC_LO " + KEYS.GEMINI_API_KEY, status: "INVALID_ARGUMENT", details: [{ "@type": "x", reason: "API_KEY_INVALID" }] } } });
  const r = await post({ message: "xin chào", provider: "gemini" }); const t = await r.text(); const j = JSON.parse(t);
  assert.equal(j.upstream, 400);
  assert.equal(j.reason, "INVALID_ARGUMENT,API_KEY_INVALID");
  assert.ok(!t.includes("KHONG_DUOC_LO") && !t.includes(KEYS.GEMINI_API_KEY) && !t.includes("not valid"));
});
test("mất kết nối tới nhà cung cấp: 502", async () => {
  globalThis.fetch = async () => { throw new Error("network down " + KEYS.ANTHROPIC_API_KEY); };
  const r = await post({ message: "xin chào" }); const t = await r.text();
  assert.equal(r.status, 502); assert.ok(!t.includes(KEYS.ANTHROPIC_API_KEY));
});
test("không có Durable Object giới hạn tốc độ thì không chạy (đóng cửa an toàn)", async () => {
  const env = makeEnv(); delete env.RATE_LIMITER;
  assert.equal((await post({ message: "xin chào" }, { env })).status, 503);
  assert.equal(calls.length, 0);
});

// ── giới hạn đầu vào ──
test("hằng số giới hạn đúng yêu cầu", () => {
  assert.equal(LIMITS.MAX_TOKENS, 400);
  assert.equal(LIMITS.RATE_LIMIT, 20);
  assert.equal(LIMITS.RATE_WINDOW_MS, 3_600_000);
  assert.ok(Object.isFrozen(LIMITS));
});
test("tin nhắn: đúng 500 ký tự qua, 501 bị chặn, rỗng/thiếu/không phải chuỗi bị chặn", async () => {
  const w500 = "abcd ".repeat(99) + "abcde", w501 = "abcd ".repeat(99) + "abcdef";
  assert.equal(w500.length, 500); assert.equal(w501.length, 501);
  assert.equal((await post({ message: w500 })).status, 200);
  const long = await post({ message: w501 }); assert.equal(long.status, 400);
  assert.match((await long.json()).error, /500 ký tự/);
  assert.equal((await post({ message: "a".repeat(60) })).status, 400, "một chuỗi liền 40 ký tự trở lên bị coi là giống khóa");
  assert.equal((await post({ message: "đ".repeat(501) })).status, 400, "đếm theo ký tự, không theo byte");
  assert.equal((await post({ message: "đ".repeat(500) })).status, 200);
  for (const m of ["", "   ", null, 123, ["a"], undefined]) assert.equal((await post({ message: m })).status, 400, JSON.stringify(m));
  assert.equal((await post({})).status, 400);
});
test("JSON hỏng, thân quá 8 KB (khai báo hoặc thực tế), history sai", async () => {
  assert.equal((await post(null, { raw: "{khong phai json" })).status, 400);
  assert.equal((await post({ message: "a", pad: "x".repeat(9000) })).status, 413);
  const chunked = new Request("https://w.example/chat", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"message":"a","pad":"' + "x".repeat(9000) + '"}')); c.close(); } }), duplex: "half" });
  assert.equal((await worker.fetch(chunked, makeEnv())).status, 413);
  assert.equal((await post({ message: "a", history: "x" })).status, 400);
  assert.equal((await post({ message: "a", history: Array(7).fill({ role: "user", content: "x" }) })).status, 400);
  assert.equal((await post({ message: "a", history: [{ role: "system", content: "x" }] })).status, 400);
  assert.equal((await post({ message: "a", history: [{ role: "user", content: "x".repeat(501) }] })).status, 400);
  assert.equal((await post({ message: "a", provider: "llama" })).status, 400);
});
test("không gửi số điện thoại, email, chuỗi giống khóa tới nhà cung cấp, và không tính vào giới hạn", async () => {
  const env = makeEnv();
  for (const m of ["số của mình 0912 345 678", "mail an@gmail.com", "khóa sk-proj-abcdefghijklmnopqrstuv", "+84 912345678"]) {
    const r = await post({ message: m }, { env }); assert.equal(r.status, 400, m);
  }
  assert.equal((await post({ message: "a", history: [{ role: "user", content: "gọi 0912345678" }] }, { env })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await post({ message: "Hotline 0947 686 668 đúng không?" }, { env })).status, 200, "hotline công ty được phép");
  const r = await post({ message: "xin chào" }, { env });
  assert.equal(r.headers.get("X-RateLimit-Remaining"), "18", "chỉ 2 tin hợp lệ đã được tính");
});

// ── giới hạn tốc độ ──
test("20 tin mỗi IP mỗi giờ: tin thứ 21 bị 429 kèm Retry-After; IP khác độc lập; hết giờ thì dùng lại được", async () => {
  const env = makeEnv(); const realNow = Date.now; let t = 1_800_000_000_000; Date.now = () => t;
  try {
    for (let i = 1; i <= 20; i++) {
      const r = await post({ message: "tin " + i }, { env, ip: "198.51.100.1" });
      assert.equal(r.status, 200, "tin " + i);
      assert.equal(r.headers.get("X-RateLimit-Remaining"), String(20 - i));
    }
    const over = await post({ message: "tin 21" }, { env, ip: "198.51.100.1" });
    assert.equal(over.status, 429);
    assert.equal(over.headers.get("Retry-After"), "3600");
    assert.equal(over.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    const n = calls.length;
    assert.equal(n, 20, "tin bị chặn không được gọi nhà cung cấp");
    assert.equal((await post({ message: "ip khác" }, { env, ip: "198.51.100.2" })).status, 200);
    t += 30 * 60 * 1000;
    assert.equal((await post({ message: "nửa giờ sau" }, { env, ip: "198.51.100.1" })).status, 429);
    t += 30 * 60 * 1000;
    assert.equal((await post({ message: "đủ một giờ" }, { env, ip: "198.51.100.1" })).status, 200);
  } finally { Date.now = realNow; }
});
test("provider all chỉ tính 1 tin", async () => {
  const env = makeEnv(); const r = await post({ message: "xin chào", provider: "all" }, { env });
  assert.equal(r.headers.get("X-RateLimit-Remaining"), "19");
});

// ── ranh đỏ đầu ra ──
test("lọc câu trả lời: giá, phần trăm, thông số, số điện thoại lạ, email, liên kết bị thay bằng câu chuyển tư vấn viên", () => {
  for (const bad of ["Cửa này khoảng 5 triệu một mét vuông ạ.", "Giảm 20% cho anh/chị ạ.", "Kính dày 24 mm cách âm tốt ạ.", "Cách âm 42 dB ạ.", "Bảo hành 10 năm ạ.",
                     "Anh/chị gọi 0988 111 222 ạ.", "Gửi mail an@gmail.com ạ.", "Xem tại https://vinakin.vn ạ.", "Xem vinakin.vn ạ.", "", "   "]) {
    const g = guardReply(bad); assert.equal(g.filtered, true, bad); assert.match(g.text, /Hotline 0947 686 668/);
  }
  const ok = guardReply("Dạ, anh/chị gọi Hotline 0947 686 668 để được tư vấn thêm ạ.");
  assert.equal(ok.filtered, false);
  assert.equal(guardReply("Dạ, giá phụ thuộc cấu hình nên em xin phép để tư vấn viên liên hệ ạ.").filtered, false, "câu từ chối nói về giá nhưng không có số tiền thì được");
});
test("lọc câu trả lời: từ tuyệt đối, so sánh hơn kém, cam kết bị thay bằng câu chuyển tư vấn viên", () => {
  for (const bad of ["Độ bền vượt trội ạ.", "Sản phẩm hơn hẳn các hệ nhôm thông thường ạ.", "Khả năng cách âm tối ưu ạ.", "Đây là lựa chọn tốt nhất ạ.",
                     "Thương hiệu hàng đầu ạ.", "Thiết kế hoàn mỹ ạ.", "Em cam kết chất lượng ạ.", "Có bảo hành đầy đủ ạ.", "Khác với đối thủ ạ."]) {
    const g = guardReply(bad); assert.equal(g.filtered, true, bad); assert.match(g.text, /Hotline 0947 686 668/);
  }
  assert.equal(guardReply("Dạ, đây là giải pháp cửa nhôm kính cao cấp châu Âu đồng bộ từ hệ nhôm, phụ kiện đến thi công ạ.").filtered, false);
  assert.equal(guardReply("Dạ, mỗi dòng sản phẩm có đặc điểm riêng nên em xin phép để tư vấn viên trao đổi cụ thể ạ.").filtered, false);
});
test("câu trả lời xấu của AI không tới được khách", async () => {
  upstream.claude = () => ({ status: 200, body: { content: [{ type: "text", text: "Giá chỉ 3 triệu, gọi 0912 345 678 ạ." }] } });
  const j = await (await post({ message: "xin chào" })).json();
  assert.equal(j.filtered, true); assert.ok(!/triệu|0912/.test(j.reply));
});
test("validate trả đúng cấu trúc", () => {
  assert.deepEqual(validate({ message: "  xin   chào  " }), { ok: true, message: "xin chào", history: [], provider: "claude" });
});

// ── không có khóa trong mã ──
test("không có khóa API nào nằm trong mã hay cấu hình (chỉ đọc từ biến môi trường)", () => {
  const root = join(HERE, ".."); const files = [];
  (function walk(d) { for (const f of readdirSync(d)) { if (f === "node_modules" || f === ".wrangler" || f === "worker.test.mjs") continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } })(root);
  assert.ok(files.length >= 5);
  const pat = /(sk-ant-[\w\-]{10,}|sk-proj-[\w\-]{10,}|sk-[A-Za-z0-9]{32,}|AIza[\w\-]{30,}|Bearer\s+[A-Za-z0-9._\-]{20,})/;
  for (const f of files) {
    if (f.endsWith(".dev.vars")) assert.fail(".dev.vars không được có trong thư mục: " + f);
    assert.ok(!pat.test(readFileSync(f, "utf8")), "chuỗi giống khóa trong " + f);
  }
  const src = readFileSync(join(root, "src", "index.js"), "utf8");
  for (const v of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"]) assert.ok(src.includes("env." + v), v + " phải đọc từ env");
  assert.ok(!/(ANTHROPIC|GEMINI|OPENAI)_API_KEY\s*=\s*["'`]/.test(src));
});
