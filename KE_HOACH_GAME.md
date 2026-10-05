# Kế hoạch single player: LASTLIGHT

Cập nhật: **05/10/2026**. Đã triển khai MVP single player 3D, 5/7 bot, 8 loại súng và điều khiển cảm ứng. Bản hiện tại chạy tại localhost/LAN; chưa xuất bản công khai. Hướng dẫn chạy và mở trên điện thoại tại [README.md](README.md), bằng chứng kiểm thử trình duyệt tại [KIEM_THU.md](KIEM_THU.md).

## Mục tiêu và phạm vi hiện tại

Game bắn súng sinh tồn lấy cảm hứng từ vòng chơi PUBG, có tên, bản đồ và phong cách hình ảnh riêng. Hỗ trợ bàn phím/chuột trên máy tính và giao diện cảm ứng trên điện thoại/máy tính bảng, góc nhìn thứ ba, đồ họa low-poly. Vòng chơi: bắt đầu → nhặt trang bị → giao tranh → di chuyển theo bo → thắng/thua → chơi lại.

| Hạng mục | Đã triển khai |
| --- | --- |
| Nhân vật | 1 người chơi + 5 hoặc 7 bot; độ khó dễ / tiêu chuẩn |
| Bản đồ | Khoảng 200 × 200 m, công trình, thùng và đá làm vật che; nhà là khối đặc, không có nội thất |
| Di chuyển | WASD theo camera, Shift chạy, Space nhảy, va chạm và camera tránh vật cản |
| Cảm ứng | Cần di chuyển bên trái, vuốt xoay camera bên phải, nút bắn/ngắm/hành động/đổi súng/pause; bố cục dọc và ngang |
| Cấu hình mobile | Mặc định 5 bot, chất lượng thấp khi chưa có cài đặt đã lưu; độ phân giải màn hình đầy đủ, tắt bóng động, giảm chi tiết trang trí và cập nhật đồ họa/HUD |
| Chiến đấu | 8 súng, ngắm, sát thương thân/đầu, vật cản chặn đạn, độ tản/giật và nạp đạn riêng |
| Trang bị | 8 ô súng; mỗi súng có băng đạn và dự trữ độc lập; thuốc hồi máu |
| AI | Tuần tra, phát hiện theo hướng/đường nhìn, giao chiến với người và bot khác, tìm đường quanh vật cản, nạp đạn, hồi máu, vào bo |
| Sinh tồn | Bo thu qua 6 giai đoạn, gây sát thương ngoài bo và cuối cùng về 0 |
| UI | Menu tiếng Việt, thiết lập, HUD, minimap, rack 8 súng, ống ngắm, thông báo và kết quả |
| Pause/reset | Esc, mất focus hoặc mất khóa chuột tạm dừng; tiếp tục, chơi lại, về menu |
| Lưu dữ liệu | localStorage lưu cài đặt và kỷ lục; tải lại trang bắt đầu từ menu, không lưu trận đang chơi |

Thắng khi người chơi còn sống và tất cả bot bị loại; thua khi người chơi chết. Mục tiêu trận đầy đủ khoảng 6–10 phút; người chơi có thể thua sớm. Chưa cam kết thời lượng cho mọi cách chơi hay FPS trên mọi máy.

## Vũ khí và điều khiển

Catalogue có thẩm quyền về tên, thứ tự, chế độ bắn, zoom, sát thương, đạn và thời gian nạp nằm tại [src/game/weapons.ts](src/game/weapons.ts). Render, mô phỏng và HUD dùng chung catalogue này.

| Phím | Súng | Chế độ bắn | Ngắm |
| --- | --- | --- | --- |
| 1 | AR-26 | Tự động | Qua vai |
| 2 | SG-8 | Bán tự động | Qua vai |
| 3 | VX-9 | Tự động | Qua vai |
| 4 | P-9 | Bán tự động | Qua vai |
| 5 | DMR-14 | Bán tự động | Ống ngắm 4× |
| 6 | SR-98 | Lên đạn từng phát | Ống ngắm 6× |
| 7 | AMR-50 | Lên đạn từng phát | Ống ngắm 8× |
| 8 | MG-60 | Tự động | Qua vai |

- Nhấn **1–8** để chọn súng đã nhặt; **Q hoặc cuộn chuột** đổi tuần tự giữa các súng đang sở hữu.
- Giữ chuột trái với súng tự động. Súng bán tự động và súng lên đạn từng phát yêu cầu nhấp lại cho mỗi phát bắn, đồng thời tuân theo nhịp bắn riêng.
- Giữ chuột phải để ngắm. DMR/SR/AMR chuyển camera tới tầm mắt, phóng đại thực theo 4×/6×/8×, hiện lens tròn và reticle. Thả chuột phải, đổi súng hoặc tạm dừng đóng ống ngắm.
- **E** nhặt vật phẩm gần nhất, **R** nạp đạn, **H** hồi máu khi đứng yên. Di chuyển, nhảy hoặc bắn hủy hồi máu.
- Trên cảm ứng, kéo cần trái để đi, kéo gần hết hành trình để chạy, vuốt vùng trống bên phải để xoay camera; giữ nút Bắn cho súng tự động, chạm từng phát cho súng bán tự động/súng ngắm. Nút Ngắm bật/tắt ngắm; các nút Nhảy, Nạp, Nhặt, Hồi máu và Tạm dừng thay phím tương ứng. Kho súng cho phép chọn súng đã nhặt.

Người chơi khởi đầu với AR-26. Cụm vật phẩm gần điểm xuất phát có đủ 8 loại súng và đạn tương ứng để thử. Mỗi súng dùng loại đạn riêng; đạn của súng khác không tăng dự trữ cho súng đang cầm. Có vật phẩm rải trên map và đồ rơi từ bot. Chưa có thay phụ kiện, chỉnh zoom hay nội thất công trình.

## Kiến trúc đã dùng

TypeScript + Vite + Babylon.js; render WebGL trong trình duyệt và phân phối bằng hosting tĩnh. Hình ảnh low-poly tạo bằng mã; âm thanh tạo bằng Web Audio. Trận chạy cục bộ sau khi tải tài nguyên, chưa có offline/PWA.

```text
src/
  main.ts              # render 3D, camera, input, vòng game
  device.ts            # nhận diện cảm ứng và độ phân giải render theo thiết bị
  weapon-models.ts     # model riêng cho 8 súng
  audio.ts             # âm thanh
  types.ts             # kiểu dữ liệu chung
  ui.ts / style.css    # menu, HUD, minimap, scope, kết quả
  game/
    weapons.ts         # catalogue trung tâm, thứ tự phím, loại đạn
    config.ts          # map và các hằng số gameplay
    simulation.ts      # di chuyển, va chạm, chiến đấu, loot, AI, bo, pause/reset
tests/
  simulation.test.ts
  weapons.test.ts
  device.test.ts
  match-scenarios.ts
```

Mô phỏng tách khỏi DOM/render, chia bước thời gian tối đa 1/30 giây. Một đồng hồ game điều khiển AI, cooldown, hồi máu và bo; pause đóng băng các bộ đếm này. Đường đạn kiểm tra vật cản từ vị trí nhân vật để tường gần vẫn chặn phát bắn. Nhân vật chết ngừng chiến đấu; chơi lại đặt lại trận, vật phẩm và thống kê.

## Tiến độ và kiểm chứng

| Mốc | Trạng thái |
| --- | --- |
| Sân tập, TPP, bắn/nạp đạn và HUD | Đã triển khai |
| Bot và trận sinh tồn với 5/7 bot | Đã triển khai |
| Loot, hồi máu, bo, thắng/thua, pause/reset | Đã triển khai |
| 8 súng, đạn riêng, rack phím số và ống ngắm | Đã triển khai |
| Điều khiển cảm ứng và cấu hình render mobile | Đã triển khai; cần kiểm chứng hiệu năng trên điện thoại thật |
| Kiểm thử logic và build | Có kiểm thử mô phỏng, 8 súng và độ phân giải render; kết quả bàn giao ghi tại KIEM_THU.md |
| Chơi thử trên trình duyệt | Phạm vi và giới hạn được ghi tại KIEM_THU.md |
| Hosting công khai và thử với người chơi ngoài máy phát triển | Chưa thực hiện |

Trong 10 seed mô phỏng chỉ quan sát bot sau khi mở rộng vũ khí, trận kết thúc sau **418–432 giây**; còn **3–6 bot tại giây 60**. Đây là bằng chứng về logic và nhịp trận trong kịch bản cố định, không thay thế việc người chơi hoàn thành các trận tự nhiên hoặc đo FPS.

## Công việc tiếp theo

1. Chơi nhiều trận tự nhiên để cân bằng 8 súng, độ khó, số lượng đạn và vị trí đồ; kiểm tra riêng cận chiến, bắn xa, đầu/thân và chuyển súng.
2. Chốt máy tính và điện thoại tham chiếu rồi đo thời gian frame, tải tài nguyên và bộ nhớ qua nhiều lần chơi lại; thử cảm ứng nhiều ngón, đổi hướng màn hình và quay lại sau khi chuyển tab. Kiểm tra thêm Edge và các cấu hình yếu trước khi đặt mục tiêu hiệu năng.
3. Chọn hosting tĩnh, xuất bản thư mục `dist/`, kiểm tra đường link, tải lần đầu, âm thanh, khóa chuột và lưu cài đặt trên địa chỉ công khai.
4. Thu phản hồi rồi ưu tiên animation, hình ảnh, bố cục map và AI. Xe, dù, nội thất, chiến dịch và multiplayer cần phạm vi/kiểm thử riêng; mobile tiếp tục được cân bằng theo thiết bị thật.

Giữ catalogue súng dùng chung và logic tách khỏi render khi mở rộng. Multiplayer chưa thuộc MVP hiện tại; nếu làm tiếp cần server quyết định trạng thái, đồng bộ mạng và kiểm chứng độ trễ riêng.
