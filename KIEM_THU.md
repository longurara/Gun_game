# Báo cáo kiểm thử LASTLIGHT

Ngày: **05/10/2026**. Phạm vi: bản single player trên web với **đảo 4 × 4 km, 100 bot, nhà vào được, trang bị 3 súng + giáp, xe**, và bản đồ nhỏ 200 m. Chạy tại localhost. Báo cáo này thay thế báo cáo cũ (8 ô súng, chỉ bản đồ nhỏ), vẫn xem được trong lịch sử Git.

## Kiểm thử tự động

- `npm test`: **87 kiểm thử vượt qua**.
  - 52 bài kế thừa: catalogue súng, bắn/trúng đầu/vật cản, nạp đạn, hồi máu, nhảy/va chạm, pause, bo, thắng/thua, reset, bot tránh vật cản, joystick, độ phân giải theo DPR. Các bài bắn đạn nay đóng băng bot (`botsFrozen`) vì bot đã biết di chuyển.
  - 3 bài lưới không gian (`spatial.test.ts`): kết quả trùng khớp với duyệt thủ công trên 1.200 hộp và 400 đoạn thẳng ngẫu nhiên.
  - 11 bài trang bị (`loadout.test.ts`): ô 1–2 súng thường và ô 3 súng lục, đổi súng khi đầy, hoàn đạn, giáp chỉ nâng cấp, giáp đỡ đúng 30/40/55%, mũ không đỡ đạn vào thân, bot rơi hết súng và giáp, bot chọn súng theo cự ly.
  - 10 bài đảo (`island.test.ts`): sinh bản đồ một lần và ổn định; mọi thứ nằm trên đất liền; nhà có cửa; ≥ 65% đồ nằm trong nhà và súng ngắm chỉ trong nhà; 101 người xuất hiện ở 101 chỗ khác nhau; đi bộ không vào được hồ và biển; vòng bo luôn thu về đất liền; **trận 100 bot trọn vẹn kết thúc trong khoảng 300–600 giây** với bot đánh nhau và bo hạ gục người; bước mô phỏng trung bình dưới 6 ms; bot ở xa vẫn di chuyển.
  - 11 bài xe (`vehicle.test.ts`): lên/xuống xe, không bắn/nạp/hồi máu khi lái, tăng tốc/rẽ/phanh/lùi, đâm tường gây hỏng và nổ, không lái xuống nước sâu, đâm người, bắn phá xe và hất người lái, người lái chết thì rơi khỏi xe, bot tự lên xe, lái đi rồi xuống.
- Kiểm tra TypeScript: **vượt qua**. Build production (ra thư mục tạm): **vượt qua**, gói JavaScript chính khoảng **1,14 MB (289 KB sau gzip)**.
- `npm run test:scenarios`: **vượt qua** (trận 7 bot trên bản đồ nhỏ).

### Nhịp trận (mô phỏng, người chơi đứng yên bất tử)

| Bản đồ | Kết quả đo |
| --- | --- |
| Đảo, 100 bot, 3 seed | Kết thúc sau **580–583 giây**. Còn sống: ~90 ở giây 60, ~70–80 ở giây 120, ~30–40 ở giây 300, 3–5 ở giây 540. Khoảng 55–67 bot bị bot khác hạ, 33–45 bị bo hạ. |
| Bản đồ nhỏ, 7 bot, 10 seed | Kết thúc sau **430–433 giây**. Bot mới biết nhặt đồ, nghe tiếng súng và né đạn nên giao tranh sớm hơn: chỉ còn 1–3 bot ở giây 60 (trước đây 3–6). Bài kiểm tra nay chỉ đòi hỏi không có "thảm sát" ngay mở đầu (còn ≥ 2 bot ở giây 20). |

### Chi phí mô phỏng

| Cấu hình | Mỗi bước mô phỏng (1/20 giây) |
| --- | --- |
| 100 bot trên đảo, AI đầy đủ cho mọi bot (trước khi có phân tầng) | khoảng **16 ms** |
| 100 bot trên đảo, AI ba tầng + lưới không gian + bộ nhớ đệm độ cao | khoảng **0,5–1 ms** |
| Bản đồ nhỏ, 7 bot | nhanh hơn khoảng **5,6 lần** so với trước (4.314 giây game trong 441 ms, trước là 2.474 ms) |

Một trận đảo đầy đủ (580 giây game) chạy trong 2,5–11 giây thực trong bộ kiểm thử.

## Kiểm tra bằng trình duyệt

Chrome trong khung xem của ứng dụng, laptop Intel Arc, bản dev:

- **Menu máy tính** (1280 × 720): lựa chọn bản đồ/số bot/độ khó, thẻ xem trước bản đồ đảo, nút bắt đầu. Đã chỉnh để vừa màn hình.
- **Đảo**: địa hình đồi, biển, hồ, rừng thông và cây lá rộng, bụi, cỏ, bầu trời và mây, thị trấn với nhà mái dốc; bên trong nhà thấy đồ nằm trên sàn và cửa sổ; gợi ý "[E] Nhặt …" hiện đúng.
- **Bảng vũ khí mới**: chỉ hiện các khẩu đang mang (kiểm tra với 1 khẩu và 3 khẩu), chip giáp hiện cấp và độ bền chỉ khi đang mặc, bảng hạ gục hiện dòng "Bạn · P-9 · Đối thủ 1".
- **Bản đồ lớn (M)** và minimap: nền địa hình nổi, biển, bãi cát, hồ, sông, đường, tên thị trấn, vòng bo và vòng kế tiếp, mũi tên người chơi.
- **Xe**: lên xe bằng F, chạy tới **108 km/h** trên đường, camera bám sau xe, đồng hồ tốc độ thay bảng vũ khí.
- **Điện thoại cầm ngang** (giả lập 740 × 360, cảm ứng): menu gọn vừa màn hình; trong trận có chip giáp, la bàn, minimap, nút điều khiển; "Kho súng" mở ra đúng 3 ô đang mang; canvas render đủ độ phân giải (1480 × 720 ở DPR 2).

### Chi phí vẽ (chỉ là ước lượng)

Khung xem không phát khung hình khi bị ẩn, nên tôi tự gọi vòng lặp render của game rồi đo: ở giữa thị trấn, mỗi lần chạy vòng lặp (mô phỏng + HUD + dựng cảnh phía CPU) mất **trung vị khoảng 4,7 ms**, ~100–130 mesh đang vẽ nhờ gộp mesh theo ô, vật phẩm dùng instance và cỏ dùng thin instance. Đây là thời gian CPU trên một laptop, **không phải số FPS đo được** và không bao gồm thời gian GPU.

## Chưa kiểm tra / giới hạn

- **Chưa chạy trên điện thoại thật.** Chỉ giả lập khung nhìn và cảm ứng trong Chrome; chưa đo FPS, nhiệt, pin hay bộ nhớ với 100 bot.
- Chưa đo FPS thực (khung xem không gửi khung hình), chưa thử Edge, Firefox, Safari.
- Chưa nghe thử âm thanh mới (tiếng động cơ, va chạm, nổ); chưa nhìn bằng mắt chỉ hướng bị bắn.
- Không có ghế phụ, xe không có hư hỏng hình ảnh theo từng bộ phận; cây là khối va chạm vuông nhỏ, cây và bụi không thay đổi tầm nhìn của bot.
- Bot ở xa không bắn thật mà giải quyết giao tranh bằng xác suất, nên tiếng súng và hiệu ứng chỉ có quanh người chơi.
- Cần chơi nhiều trận tự nhiên để cân bằng: độ khó của bot (bot mới nguy hiểm hơn, nhất là ở bản đồ nhỏ), số lượng đồ, giá trị giáp, tốc độ xe, độ rộng cửa nhà.
- Ảnh minh chứng chụp trong phiên này không lưu vào repo.
