# Asset miễn phí bổ sung cho LASTLIGHT

Đối chiếu mã game và xác minh trang nguồn ngày **06/10/2026**. Đây là **14 bộ/nguồn mới được nghiên cứu**, chưa tải archive hoặc áp dụng vào game trong đợt này. Số lượng dưới đây là số file tác giả công bố, có thể gồm biến thể; chưa phải số model độc lập đã kiểm tra.

## Menu, hồ sơ và HUD

| Nguồn chính chủ | Nội dung công bố | Ứng dụng đề xuất | Giấy phép |
| --- | --- | --- | --- |
| [Kenney Ranks Pack](https://kenney.nl/assets/ranks-pack) | 70 asset rank/medal | Phù hiệu hồ sơ, bảng xếp hạng, hàng người chơi trong phòng online | CC0 |
| [Kenney Medals](https://kenney.nl/assets/medals) | 27 asset huy chương/ribbon | Biểu tượng thành tích và kết quả bài tập; chỉ gắn với thành tích game thực sự có | CC0 |
| [Kenney Skyboxes](https://kenney.nl/assets/skyboxes) | 5 asset bầu trời, mây | Bầu trời phía sau cảnh SWAT trong menu và trên bản đồ | CC0 |
| [Kenney Crosshair Pack](https://kenney.nl/assets/crosshair-pack) | 200 file; 64 × 64; có vector và biến thể glow | Bộ tâm ngắm lựa chọn; giữ độ giãn phản ánh độ chính xác của tâm hiện tại | CC0 |
| [Kenney Mobile Controls](https://kenney.nl/assets/mobile-controls) | 900 file control/button/HUD | Hình cần điều khiển và nút hành động trên điện thoại; giữ vùng chạm và hành vi hiện tại | CC0 |
| [Kenney Minimap Pack](https://kenney.nl/assets/minimap-pack) | 150 file pixel, ô 8 × 8 | Ứng viên phụ cho marker; kiểu pixel không đồng bộ trực tiếp với HUD hiện tại | CC0 |

## Hiệu ứng và âm thanh chiến đấu

| Nguồn chính chủ | Nội dung công bố | Ứng dụng đề xuất | Giấy phép |
| --- | --- | --- | --- |
| [Kenney Particle Pack](https://kenney.nl/assets/particle-pack) | 80 texture VFX; 512 × 512 | Chọn texture phù hợp cho chớp đầu nòng, tia lửa, bụi và hiệu ứng nổ; cần cấu hình particle trong Babylon | CC0 |
| [Kenney Smoke Particles](https://kenney.nl/assets/smoke-particles) | 70 file khói/explosion/VFX | Thay hình cầu khói trong `src/main.ts` bằng particle/sprite; khói đỏ hộp tiếp tế | CC0 |
| [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) | 130 âm thanh impact/foley | Chọn âm va chạm theo vật liệu cho đạn, đồ rơi, xe; cần nghe và chuẩn hóa từng mẫu | CC0 |
| [Gun reload sounds — SpringySpringo](https://opengameart.org/content/gun-reload-sounds) | 3 WAV: `gunreload1.wav`, `assaultriflereload1.wav`, `shotguncock.wav` | Nạp đạn pistol/rifle và lên đạn shotgun; tác giả tự thu từ súng airsoft | CC0; tác giả ghi công tùy chọn |

## Xe và môi trường

| Nguồn chính chủ | Nội dung công bố | Ứng dụng đề xuất | Giấy phép |
| --- | --- | --- | --- |
| [Kenney Car Kit](https://kenney.nl/assets/car-kit) | 45 asset; cập nhật có debris/kart | Ưu tiên xe dân dụng trong 12 loại xe hiện tại; chưa xác nhận pack phủ đủ bike, scooter, tuktuk, sidecar | CC0 |
| [Low Poly Military Vehicles — Zsky](https://zsky2000.itch.io/low-poly-military-vehicles) | 9 model; Blend/FBX/OBJ; ZIP 4,7 MB | Xe/props cho doanh trại, cần chuyển GLB và đối chiếu từng dáng xe với gameplay | CC BY 4.0 — ghi công Zsky |
| [Kenney Nature Kit](https://kenney.nl/assets/nature-kit) | 330 asset 3D, chủ đề cây/đá/foliage | Thêm biến thể cây, bụi, đá theo từng biome; instance và dùng model nhẹ ở xa | CC0 |
| [Kenney Foliage Sprites](https://kenney.nl/assets/foliage-sprites) | 50 file 2D foliage/grass/VFX | Cỏ và lá trên plane/atlas, cần kiểm tra độ trong suốt và chi phí vẽ nhiều lớp trên mobile | CC0 |

## Thứ tự nên áp dụng

1. **Menu:** Ranks + Medals cho hồ sơ/thành tích có sẵn; Skyboxes cho nền 3D. Giữ khung Bunker và màu tối/vàng đã tích hợp.
2. **Trong trận:** Particle Pack + Smoke Particles. Khói hiện là các sphere, khói hộp tiếp tế là cylinder; đây là chỗ có thể thay đổi hình ảnh rõ với số file chọn nhỏ. Giữ vùng che tầm nhìn/radius theo dữ liệu gameplay.
3. **Xe:** Car Kit cho vài loại xe phổ biến trước. Giữ hitbox, chiều cao người lái, chỗ vào xe và bánh xe khớp model; không coi toàn bộ 45 file là 45 loại xe hoặc là đủ cả 12 loại hiện tại.
4. **Môi trường:** Nature Kit + Foliage Sprites. Game đã có atlas cây/lá và cây dựng bằng code, nên dùng model mới để bổ sung biến thể theo biome, tránh tăng số vật thể không giới hạn.
5. **Âm thanh:** Chọn vài reload/impact phù hợp; giữ shared master volume, khoảng cách và stereo pan của `GameAudio`.

Thư viện công trình hiện có **860 GLB nguồn** từ 10 gói Kenney nhưng chưa tích hợp hình học vào bản đồ; xem `assets-source/free-buildings/README.md`. Danh sách súng còn thiếu LMG/launcher và model bổ sung ở `docs/FREE_WEAPON_ASSETS.md`. Các bộ trong tài liệu này bổ sung những nhóm khác để tránh tải lại cùng nội dung.

Khi tải: giữ giấy phép trong archive, ghi trang nguồn và checksum; chỉ đưa file đang dùng vào bản build. Zsky cần thêm tên tác giả, tên pack và CC BY 4.0 vào mục **NGUỒN ASSET** hiện có. Các pack CC0 trong danh sách được xác minh tại trang tác giả; định dạng/model cụ thể cần kiểm tra từ archive khi chọn để tích hợp.
