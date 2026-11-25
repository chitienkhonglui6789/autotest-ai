import React, { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";

const ARCHETYPE_GUIDES = [
  {
    num: 1,
    title: "Ô nhập liệu (Input / Textarea / Search / OTP / Date)",
    badge: "Nhãn · Placeholder · Tên trường · Khối",
    accent: "text-sky-300 border-sky-500/30 bg-sky-950/20",
    tip: "Gọi theo Nhãn hiển thị, Placeholder hoặc tên trường kỹ thuật (name/id) đều được. Khi trùng nhãn, nêu rõ Khối hoặc Modal.",
    examples: [
      'Nhập "admin" vào ô Tên đăng nhập',
      'Nhập "admin" vào ô "điền username" (theo placeholder)',
      'Nhập "admin" vào ô username (theo tên trường kỹ thuật)',
      'Nhập "0901234567" vào ô Số điện thoại trong khối Thông tin người nhận',
    ],
  },
  {
    num: 2,
    title: "Nút bấm, Liên kết & Nút có số đếm động",
    badge: "Tên gốc · Vùng Header/Sidebar/Modal",
    accent: "text-indigo-300 border-indigo-500/30 bg-indigo-950/20",
    tip: "Nút kèm số đếm thay đổi như Giỏ hàng (3) chỉ cần gọi tên gốc. Nêu rõ vùng giao diện khi có nút trùng tên.",
    examples: [
      'Bấm nút "Đăng nhập" / Bấm liên kết "Quên mật khẩu"',
      'Bấm nút "Giỏ hàng" (tự khớp kể cả khi đổi thành Giỏ hàng (5))',
      'Bấm nút "Tìm kiếm" ở Header / Bấm nút "Lưu" trong Modal',
    ],
  },
  {
    num: 3,
    title: "Nút chỉ có Icon & Hình ảnh / Avatar",
    badge: "Icon · Tooltip · Alt · Thứ tự",
    accent: "text-violet-300 border-violet-500/30 bg-violet-950/20",
    tip: "Mô tả ý nghĩa biểu tượng (đóng, thùng rác, kính lúp, chỉnh sửa) hoặc mô tả ảnh/thứ tự hiển thị.",
    examples: [
      'Bấm nút biểu tượng đóng (X) trên hộp thoại',
      'Bấm icon thùng rác ở dòng "DH-1001" / Bấm nút kính lúp tìm kiếm',
      'Bấm vào ảnh đại diện "Avatar" thứ 2',
    ],
  },
  {
    num: 4,
    title: "Hộp chọn Dropdown / Combobox (Native & Custom)",
    badge: "Chọn trực tiếp · Cascading Tỉnh → Quận",
    accent: "text-cyan-300 border-cyan-500/30 bg-cyan-950/20",
    tip: "Luôn gọi theo nhãn ô chọn (không phụ thuộc giá trị đang chọn sẵn). Với danh sách phụ thuộc, tách thành 2 bước nối tiếp.",
    examples: [
      'Chọn "Hà Nội" trong mục Tỉnh/Thành phố',
      'Bước 1: Chọn "TP.HCM" trong mục Tỉnh/Thành phố',
      'Bước 2: Chọn "Quận 1" trong mục Quận/Huyện',
    ],
  },
  {
    num: 5,
    title: "Checkbox / Radio / Switch (2 tầng nhãn)",
    badge: "Đơn lẻ · Nhóm câu hỏi",
    accent: "text-teal-300 border-teal-500/30 bg-teal-950/20",
    tip: "Khi nhiều nhóm có lựa chọn trùng tên (vd cùng có \"Khác\"), ghi rõ cả nhãn lựa chọn lẫn tên nhóm câu hỏi.",
    examples: [
      'Tích chọn "Tôi đồng ý điều khoản" / Bỏ chọn "Ghi nhớ đăng nhập"',
      'Bật công tắc "Kích hoạt tài khoản"',
      'Chọn "Nam" ở mục Giới tính / Chọn "Khác" ở mục Nguồn khách',
    ],
  },
  {
    num: 6,
    title: "Bảng dữ liệu & Danh sách lặp (Row / Card)",
    badge: "Ngữ cảnh dòng · Thứ tự #k",
    accent: "text-amber-300 border-amber-500/30 bg-amber-950/20",
    tip: "Gắn mã dòng, tên sản phẩm hoặc tên nhân viên để khóa đúng hàng; nêu rõ thứ tự nếu các mục hoàn toàn giống nhau.",
    examples: [
      'Bấm nút "Xóa" ở dòng đơn hàng "DH-1001"',
      'Bấm "Thêm vào giỏ" ở thẻ sản phẩm "iPhone 15 Pro"',
      'Bấm nút "Chỉnh sửa" thứ 2',
    ],
  },
  {
    num: 7,
    title: "Tải tệp, Hộp thoại Native, Kéo thả & Đa Tab",
    badge: "File · Alert/Confirm/Prompt · DnD · Tab",
    accent: "text-orange-300 border-orange-500/30 bg-orange-950/20",
    tip: "Engine tự lắng nghe native dialog (không bị treo), hỗ trợ tải tệp từ thư mục dữ liệu và chuyển đổi giữa nhiều Tab.",
    examples: [
      'Tải lên tệp "invoice.pdf" vào ô Đính kèm chứng từ',
      'Bấm "Xóa" và bấm Đồng ý trên hộp thoại (hoặc bấm Hủy để từ chối)',
      'Nhập "Hết hàng" vào hộp thoại prompt rồi bấm OK',
      'Kéo thẻ "Task #1" thả vào cột "Đang xử lý"',
      'Chuyển sang tab mới nhất / Quay lại tab đầu tiên / Đóng tab hiện tại',
    ],
  },
  {
    num: 8,
    title: "Kiểm tra (Assert) & Biến {{...}}",
    badge: "Chữ · Giá trị · Trạng thái · Bảng · URL · Tiền/Số",
    accent: "text-emerald-300 border-emerald-500/30 bg-emerald-950/20",
    tip: "Bắt đầu bằng \"Kiểm tra...\" hoặc \"Xác nhận...\" để kích hoạt bộ kiểm chứng tất định. Dùng {{...}} để truyền dữ liệu giữa các bước.",
    examples: [
      'Kiểm tra hiển thị "Đăng nhập thành công" / Kiểm tra không còn hiển thị "Đang tải..."',
      'Kiểm tra ô Mã đơn có giá trị khác rỗng / Kiểm tra nút "Lưu" đang bị vô hiệu hóa',
      'Kiểm tra ô "Ghi nhớ" đã được tích / Kiểm tra bảng có ít nhất 1 dòng',
      'Kiểm tra URL chứa "/dashboard" / Kiểm tra tổng tiền bằng "58.500.000đ"',
      'Đọc mã đơn hàng lưu vào biến {{ma_don}} → Nhập {{ma_don}} vào ô Tìm kiếm [soft]',
    ],
  },
];

export function HelpModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState("script");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-5 py-3.5 border-b border-slate-700 flex items-center justify-between bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-lg">💡</span>
            <div>
              <h3 className="text-sm font-semibold text-white">Cẩm nang AutoTest Studio v9.0 (Playwright Native + Micro-ReAct)</h3>
              <p className="text-[11px] text-slate-400">
                Hướng dẫn soạn bước tiếng Việt cho 8 nhóm thao tác UI, Step Cache ⚡, biến động và phân loại kết quả 4 trạng thái
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
            title="Đóng (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-slate-800 bg-slate-950/40 px-4 pt-2 gap-1.5 shrink-0 overflow-x-auto">
          {[
            { id: "script", label: "✍️ Soạn bước & Tách bước AI" },
            { id: "archetypes", label: "📋 Mẫu câu 8 nhóm thao tác" },
            { id: "cache", label: "⚡ Step Cache & Biến {{...}}" },
            { id: "status", label: "🚦 Live Progress & Mã lỗi" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? "bg-slate-800 text-indigo-300 border-indigo-500"
                  : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-300 leading-relaxed flex-1 select-text">
          {activeTab === "script" && (
            <>
              <div className="p-3.5 rounded-lg bg-indigo-950/30 border border-indigo-500/30 space-y-1.5">
                <div className="font-semibold text-indigo-300">✨ Dán &amp; Tách bước thông minh</div>
                <p>
                  Nếu bạn có đoạn văn bản nhiều câu (từ Jira, Zalo, Excel), hãy bấm nút{" "}
                  <strong className="text-white">Dán &amp; Tách bước</strong> trong Trình soạn thảo (hoặc dán thẳng văn bản nhiều dòng vào ô bước). Studio sẽ tách thành từng bước rõ ràng để dễ sửa, theo dõi trực tiếp và lưu Cache cho từng bước.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-rose-950/20 border border-rose-500/30 space-y-1">
                  <div className="font-semibold text-rose-300">❌ Cách viết dễ gây nhầm</div>
                  <div className="font-mono text-[11px] text-slate-300">
                    • Vào trang chủ rồi đăng nhập<br />
                    • Chọn mục thứ nhất rồi bấm nút kia<br />
                    • Kiểm tra xem vào được chưa?
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 space-y-1">
                  <div className="font-semibold text-emerald-300">✓ Cách viết chuẩn v9.0</div>
                  <div className="font-mono text-[11px] text-slate-200">
                    • Mở trang http://127.0.0.1:5050<br />
                    • Nhập admin vào ô Tên đăng nhập<br />
                    • Kiểm tra thông báo &apos;Đăng nhập thành công&apos;
                  </div>
                </div>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-semibold text-sky-300">🎯 Nhận diện phần tử đa chiều (5D Identity)</div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("archetypes")}
                    className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200 underline underline-offset-2 cursor-pointer"
                  >
                    Xem mẫu câu cho 8 nhóm thao tác →
                  </button>
                </div>
                <p className="text-slate-300">
                  Engine đối chiếu đồng thời <strong className="text-white">Nhãn hiển thị</strong> (tự bỏ dấu <span className="font-mono text-slate-200">*</span>, <span className="font-mono text-slate-200">:</span>, số đếm động),{" "}
                  <strong className="text-white">Placeholder</strong>, <strong className="text-white">tên trường kỹ thuật</strong> (<span className="font-mono text-slate-200">name</span>/<span className="font-mono text-slate-200">id</span>),{" "}
                  <strong className="text-white">Nhóm câu hỏi</strong>, <strong className="text-white">Khối/Vùng</strong> (<span className="font-mono text-slate-200">Header/Sidebar/Modal</span>) và{" "}
                  <strong className="text-white">Dòng bảng / thứ tự #k</strong>. Chỉ cần nêu đủ ngữ cảnh khi trên trang có nhiều phần tử trùng tên.
                </p>
              </div>
            </>
          )}

          {activeTab === "archetypes" && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-[11px] text-slate-300">
                Mẫu câu chuẩn tiếng Việt cho <strong className="text-white">8 nhóm thao tác giao diện</strong> phổ biến nhất. Bạn có thể sao chép và thay tên trường/dữ liệu thực tế của dự án.
              </div>
              <div className="grid grid-cols-1 gap-2.5">
                {ARCHETYPE_GUIDES.map((item) => (
                  <div
                    key={item.num}
                    className={`p-3 rounded-lg border space-y-1.5 ${item.accent}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-semibold text-xs">
                        {item.num}. {item.title}
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950/70 border border-slate-700/80 text-slate-300">
                        {item.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300">{item.tip}</p>
                    <div className="p-2 rounded bg-slate-950/75 border border-slate-800/90 font-mono text-[11px] text-slate-200 space-y-0.5">
                      {item.examples.map((ex, idx) => (
                        <div key={idx}>• {ex}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "cache" && (
            <>
              <div className="p-3.5 rounded-lg bg-emerald-950/25 border border-emerald-500/30 space-y-1.5">
                <div className="font-semibold text-emerald-300">⚡ Step Trace Cache — Chạy lại trong ~0.05s</div>
                <p>
                  Ở lần đầu, AI Micro-ReAct dò tìm phần tử và tự động lưu dấu vân tay ngữ nghĩa 5 chiều (nhãn sạch, nhóm câu hỏi, khối/vùng, ngữ cảnh dòng, thứ tự) vào Cache. Những lần chạy sau phát lại thẳng bằng Playwright Native (tốn 0 gọi AI) và vẫn bền vững khi placeholder hay số đếm trên nút (vd <span className="font-mono text-slate-200">Giỏ hàng (3) → (5)</span>) thay đổi. Nếu muốn AI học lại từ đầu, bấm <strong className="text-white">Quên Cache</strong> ở thanh đáy hoặc bấm biểu tượng <strong className="text-emerald-300">⚡ Cache</strong> trên từng dòng bước.
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5 font-mono text-[11px]">
                <div className="font-sans font-semibold text-sky-300">📦 Biến trích xuất &amp; Soft Assertion:</div>
                <div>• Đọc giá trị: <span className="text-white">Đọc mã đơn hàng và lưu vào biến &#123;&#123;ma_don&#125;&#125;</span></div>
                <div>• Dùng lại ngay: <span className="text-white">Nhập &#123;&#123;LAST_EXTRACTED&#125;&#125; vào ô Tìm kiếm</span></div>
                <div>• Bỏ qua dừng kịch bản khi check phụ: gắn <span className="text-amber-300">[soft]</span> ở cuối bước.</div>
              </div>
            </>
          )}

          {activeTab === "status" && (
            <div className="space-y-3.5">
              <p>
                Khi đang chạy test, tab <strong className="text-white">Lịch sử kiểm thử</strong> tự động mở tính năng đang chạy để hiển thị thanh tiến độ từng bước, tầng thực thi (<span className="text-emerald-300 font-mono">⚡ Cache</span> / <span className="text-sky-300 font-mono">FastPath</span> / <span className="text-indigo-300 font-mono">AI Nhịp x/12</span>), suy luận của AI và ảnh chụp ngay khi từng bước hoàn tất.
              </p>

              <div className="space-y-2">
                <div className="font-semibold text-white">🏷️ 4 Trạng thái Kết luận (Verdict Badges)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded font-bold font-mono text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      PASSED
                    </span>
                    <p className="text-slate-300">Đạt toàn bộ thao tác và kiểm chứng nghiệp vụ, không có cảnh báo.</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded font-bold font-mono text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      PASSED_WITH_WARNINGS (PASS*)
                    </span>
                    <p className="text-slate-300">Đạt kiểm chứng chính nhưng có lưu ý phi chặn (cảnh báo UX/Advisory hoặc bước <span className="font-mono text-amber-200">[soft]</span>).</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded font-bold font-mono text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/40">
                      FAILED
                    </span>
                    <p className="text-slate-300"><strong className="text-rose-300">Lỗi sản phẩm (Product Defect)</strong> — hệ thống web hoạt động sai kỳ vọng hoặc phát sinh lỗi nghiệp vụ/API.</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded font-bold font-mono text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40">
                      BROKEN
                    </span>
                    <p className="text-slate-300"><strong className="text-purple-300">Lỗi kịch bản / hạ tầng / AI</strong> — bước gián đoạn do không tìm thấy phần tử, timeout hoặc lỗi môi trường (chưa kết luận lỗi sản phẩm).</p>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-[11px] space-y-2">
                <div className="font-semibold text-rose-300">🔴 Nhóm mã lỗi sản phẩm → FAILED</div>
                <div className="font-mono space-y-1 text-slate-300">
                  <div><span className="text-rose-400 font-bold">ASSERTION_FAILED</span>: Chữ/thông báo kỳ vọng, giá trị ô, trạng thái, số dòng, URL hoặc phép so sánh tiền/số không khớp.</div>
                  <div><span className="text-rose-400 font-bold">POST_CONDITION_FAILED</span>: Thao tác đã chạy nhưng hậu điều kiện mong đợi sau hành động không đạt được.</div>
                  <div><span className="text-rose-400 font-bold">HTTP_ERROR</span>: Trang đích hoặc điều hướng trả về mã lỗi HTTP 4xx/5xx (vd: 404, 500).</div>
                  <div><span className="text-rose-400 font-bold">SILENT_FAILURE</span>: Thao tác gửi/lưu phát sinh lỗi ngầm nhân quả (cảnh báo lỗi trên UI, Form Validation, API 4xx/5xx sau submit, hoặc lỗi JS ở chế độ Strict).</div>
                </div>
                <div className="pt-1.5 border-t border-slate-800 font-semibold text-purple-300">🟣 Nhóm mã lỗi kịch bản / hạ tầng → BROKEN</div>
                <div className="font-mono space-y-1 text-slate-300">
                  <div><span className="text-purple-400 font-bold">ELEMENT_NOT_FOUND</span>: Không tìm thấy phần tử khớp nhãn, placeholder, ngữ cảnh dòng/khối hoặc vùng mô tả.</div>
                  <div><span className="text-amber-400 font-bold">TIMEOUT</span>: Trang web đích tải quá lâu, phần tử không kịp hiển thị hoặc không phản hồi đúng hạn.</div>
                  <div><span className="text-purple-400 font-bold">EXECUTION_ERROR</span>: Lỗi hạ tầng chạy test, sai URL, lỗi trình duyệt hoặc lỗi phản hồi từ AI.</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}
