# Kế hoạch single player: LASTLIGHT

Cập nhật: **05/10/2026**. Từ bản MVP đấu trường 200 m, dự án đã mở rộng thành **đảo 4 × 4 km với 100 bot**, nhà vào được, hệ trang bị 3 súng + giáp, xe, AI thông minh hơn và giao diện mới. Bản hiện tại chạy tại localhost/LAN; chưa xuất bản công khai. Hướng dẫn chạy tại [README.md](README.md), kết quả kiểm thử tại [KIEM_THU.md](KIEM_THU.md).

## Mục tiêu và phạm vi hiện tại

Game bắn súng sinh tồn lấy cảm hứng từ vòng chơi battle royale, có tên, bản đồ và phong cách hình ảnh riêng. Hỗ trợ bàn phím/chuột và cảm ứng, góc nhìn thứ ba, đồ họa low-poly có chiều sâu. Vòng chơi: nhảy xuống đảo → lục nhà tìm súng, giáp → giao tranh → di chuyển (đi bộ hoặc lái xe) theo bo → thắng/thua → chơi lại.

| Hạng mục | Đã triển khai |
| --- | --- |
| Bản đồ | Đảo 4 × 4 km sinh từ hạt giống cố định (đồi núi, bờ biển, 7 hồ, 3 sông cạn, ruộng, rừng, 16 thị trấn, đường); bản đồ nhỏ 200 m vẫn giữ |
| Nhân vật | 1 người chơi + 25/50/**100** bot trên đảo, hoặc 5/7 bot ở bản đồ nhỏ; độ khó dễ / tiêu chuẩn |
| Nhà | Vào được: tường có cửa và cửa sổ, mái dốc; ~390 nhà; ~3/4 vật phẩm nằm trong nhà |
| Trang bị | Tối đa 3 súng (2 súng thường + 1 súng lục), đổi súng khi đầy; giáp mũ và áo cấp 1–3 có độ bền; HUD chỉ hiện đồ đang mang |
| Xe | ~47 xe, lái, va chạm, đâm người, bị bắn thì nổ; bot tự lên xe lái đi xa |
| Chiến đấu | 8 súng, ngắm/ống ngắm 4–8×, sát thương thân/đầu, vật cản và địa hình chặn đạn |
| AI | Nhặt đồ theo giá trị, nghe tiếng súng, né ngang, ngắm có độ trễ, bắn theo loạt, đổi súng theo cự ly, tìm chỗ khuất để hồi máu, lên xe, vào bo; ba mức chi tiết theo khoảng cách tới người chơi |
| Sinh tồn | Bo thu qua 7 giai đoạn trên đảo (6 ở bản đồ nhỏ), luôn về đất liền; biển và hồ chặn đường |
| UI | Menu mới (chọn bản đồ/bot/độ khó, thẻ xem trước), HUD mới (chip còn sống/hạ gục, thanh máu + giáp, ô vũ khí động, bảng hạ gục, chỉ hướng bị bắn, đồng hồ xe), bản đồ lớn (M) |
| Điều khiển | Bàn phím/chuột và cảm ứng; F lên/xuống xe, 1–3 chọn súng, M bản đồ |
| Lưu dữ liệu | localStorage lưu cài đặt và kỷ lục; không lưu trận đang chơi |

Thắng khi bạn còn sống và mọi bot bị loại; thua khi bạn chết. Trận đảo đầy đủ khoảng 9–10 phút (đo trong mô phỏng); trận bản đồ nhỏ khoảng 7 phút.

## Kiến trúc

TypeScript + Vite + Babylon.js; render WebGL, phân phối bằng hosting tĩnh. Hình ảnh và bản đồ tạo bằng mã (không tải asset); âm thanh tạo bằng Web Audio.

```text
src/
  main.ts              # render, camera, input, vòng game, xe, vật phẩm, kết nối giao diện
  island-renderer.ts   # dựng đảo theo ô: địa hình 3 mức chi tiết, nhà, cây, bụi, đường
  island-decor.ts      # biển, hồ, sông, bầu trời, mây, cỏ quanh người chơi
  device.ts            # nhận diện cảm ứng và độ phân giải render theo thiết bị
  weapon-models.ts     # model riêng cho 8 súng
  audio.ts             # âm thanh (súng, động cơ, va chạm, nổ)
  ui.ts / style.css / theme.css   # menu, HUD, bản đồ lớn; theme.css là lớp giao diện mới
  game/
    weapons.ts         # catalogue súng, ô trang bị, hằng số giáp
    world.ts           # sinh đảo: địa hình, nước, thị trấn, nhà, cây, vị trí đồ/xe
    config.ts          # bản đồ nhỏ và hằng số
    spatial.ts         # lưới không gian (vật cản, actor, vật phẩm)
    bot-logic.ts       # chọn súng, giá trị vật phẩm, sức mạnh giao tranh xa
    drop.ts            # nhảy dù: đường bay máy bay, tốc độ rơi/lượn, tầm lượn
    simulation.ts      # di chuyển, chiến đấu, loot, giáp, xe, AI, bo, nhảy dù, pause/reset
tests/                 # 378 bài (thêm giật súng, tư thế, hỗ trợ ngắm): mô phỏng, súng, trang bị, đảo, xe, nhảy dù, gyro, giao diện (jsdom), lưới không gian, thiết bị
```

Mô phỏng tách khỏi DOM/render, chia bước tối đa 1/30 giây, có hạt giống ngẫu nhiên nên lặp lại được. Nguyên tắc để 100 bot chạy nhẹ: lưới không gian cho mọi truy vấn; AI ba tầng (gần: đầy đủ mỗi bước; tầm trung: vài lần/giây; xa: một thói quen nhẹ với giao tranh bằng xác suất); độ cao địa hình lấy từ bộ đệm theo ô; tìm đường A\* cục bộ có ngân sách mỗi bước. Phía vẽ: địa hình và vật thể gộp thành mesh theo ô, vật phẩm dùng instance, cỏ dùng thin instance, bot và xe chỉ dựng khi ở gần.

## Tiến độ

| Mốc | Trạng thái |
| --- | --- |
| Nền: bản đồ dữ liệu, lưới không gian, đo hiệu năng | Hoàn thành |
| Đảo 4 × 4 km, địa hình, nước, thị trấn | Hoàn thành |
| 100 bot, AI ba tầng, AI mới | Hoàn thành; cần cân bằng bằng chơi thử |
| Nhà vào được, vật phẩm trong nhà | Hoàn thành |
| Trang bị 3 súng + giáp, HUD mới | Hoàn thành |
| Xe và bot lái xe | Hoàn thành; cần chơi thử cảm giác lái |
| Menu/HUD thiết kế lại, bản đồ lớn | Hoàn thành |
| Nhảy dù từ máy bay: người chơi và 100 bot chọn điểm đáp | Hoàn thành; cần cân bằng bằng chơi thử |
| Cờ đáp, tự lái dù, hộp tiếp tế, xem tiếp, âm thanh stereo, gợi ý, đo FPS, HTTPS dev | Hoàn thành |
| Ngồi/nằm, giật súng theo mẫu kiểu PUBG PC, tán đạn khi di chuyển, hỗ trợ ngắm cảm ứng | Hoàn thành; cần cân bằng bằng chơi thử |
| Kiểm thử logic và giao diện (378 bài) và build | Đạt |
| Chơi thử trên trình duyệt | Đã kiểm tra các luồng chính (xem KIEM_THU.md) |
| Đo FPS và thử trên điện thoại thật | **Chưa thực hiện** |
| Hosting công khai | Chưa thực hiện |

## Công việc tiếp theo

1. **Đo trên thiết bị thật.** Chốt máy tính và điện thoại tham chiếu, đo FPS/thời gian frame/bộ nhớ qua nhiều lần chơi lại với 100 bot; thử nhiều ngón, đổi hướng màn hình, quay lại sau khi chuyển tab. Nếu điện thoại yếu hơn dự kiến, có thể giảm bán kính dựng ô (`viewChunks`), số cỏ và số bot mặc định.
2. **Cân bằng bằng chơi thật.** Độ nguy hiểm của bot (đặc biệt bản đồ nhỏ), mật độ đồ và giáp, tốc độ/độ bền xe, độ rộng cửa nhà, nhịp bo.
3. **Hoàn thiện hình ảnh.** Animation nhân vật, nội thất nhà, hiệu ứng nước và va chạm xe, đèn xe; kiểm tra phối màu địa hình theo nhiều thời điểm.
4. **Xe nâng cao.** Ghế phụ, nhiên liệu, các loại xe, cầu qua sông; bot lái an toàn hơn trong thị trấn.
5. **Xuất bản.** Chọn hosting tĩnh, đưa thư mục `dist/` lên, kiểm tra đường link, tải lần đầu, âm thanh, khóa chuột và lưu cài đặt trên địa chỉ công khai.

Giữ catalogue súng dùng chung và logic tách khỏi render khi mở rộng. Multiplayer chưa thuộc phạm vi hiện tại; nếu làm tiếp cần máy chủ quyết định trạng thái, đồng bộ mạng và kiểm chứng độ trễ riêng.
