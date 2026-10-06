# Asset máy bay cho LASTLIGHT

Đã áp dụng ngày 06/10/2026: **Airplane của Poly by Google**, CC BY 3.0, GLB 158.364 byte và 1.426 tam giác. Cargo Plane của Arifido._ yêu cầu đăng nhập Sketchfab để tải; dùng phương án GLB nhẹ có đường tải trực tiếp đã xác minh.

Máy bay GLB dùng cho đoạn bay qua bản đồ và thả quân. Giữ model procedural trong `createPlaneModel()` ở `src/main.ts` làm dự phòng khi chờ tải hoặc tải lỗi. Quỹ đạo/tốc độ/nhảy dù ở `src/game/drop.ts` và simulation tách khỏi ngoại hình.

| Model | Tác giả / giấy phép | Dữ liệu xác minh | Vai trò đề xuất |
| --- | --- | --- | --- |
| [Low Poly Cargo Plane](https://sketchfab.com/3d-models/low-poly-cargo-plane-08c6bc7b8b1b482b844e9270592fe2bc) | Arifido._ / CC BY 4.0 | API Sketchfab xác nhận downloadable, 17.076 tam giác, 10.454 vertex; ghi công bắt buộc, dùng thương mại được | Ưu tiên cho máy bay vận tải thả quân; cần đăng nhập Sketchfab để tải, chưa kiểm tra file tải hoặc animation |
| [Airplane](https://poly.pizza/m/2eG17I-VDiG) | Poly by Google / CC BY 3.0 | GLB 158.364 byte, 1.426 tam giác, 1 mesh, 0 animation; texture PNG nhúng | Đã áp dụng, máy bay dân dụng |
| [Airplane](https://poly.pizza/m/a3XrQkLNna9) | Poly by Google / CC BY 3.0 | GLB 193.456 byte, 11.287 tam giác, 1 mesh, 0 animation; không có image URI ngoài | Máy bay dân dụng nhiều hình học hơn |
| [Small Airplane](https://poly.pizza/m/7cvx6ex-xfL) | Vojtěch Balák / CC BY 3.0 | GLB 36.200 byte, 584 tam giác, 2 mesh, 0 animation; node thân và cánh quạt tách riêng | Máy bay nhỏ; có thể xoay cánh quạt bằng code, không phù hợp làm vận tải đông người |

Dữ liệu Sketchfab từ API công khai `/v3/models/08c6bc7b8b1b482b844e9270592fe2bc`; license URL trả về `https://creativecommons.org/licenses/by/4.0/`. API download không đăng nhập trả lỗi xác thực. Poly Pizza xác minh tác giả/giấy phép từ dữ liệu trang; ba GLB được đọc để kiểm tra geometry/animation, chỉ model đã chọn được lưu phục vụ game.

`src/aircraft-assets.ts` tải model khi máy bay xuất hiện, cache theo scene; tái sử dụng một instance qua các lần chơi lại. Giữ texture gốc khi đổi sang StandardMaterial để hợp ánh sáng game. Căn mũi +Z, sải cánh 34 m và tâm ngang/dọc ở gốc actor; vị trí và yaw tiếp tục theo simulation. Đèn trái/phải lấy tọa độ đầu cánh, strobe ở đỉnh đuôi. Mesh máy bay không tham gia picking súng.

Model gốc giữ nguyên ở `public/assets/aircraft/airplane.glb`; nguồn, số byte, hash SHA-256 và giấy phép trong `manifest.json`, ghi công trong `CREDITS.md` và menu. Tải lại bằng `npm run assets:fetch-aircraft`. Không cần công cụ chuyển đổi hoặc tài khoản để tải mẫu này.

Kiểm chứng: test hash, texture nhúng và số tam giác; trình duyệt kiểm tra model thật thay dự phòng, texture, sải cánh/hướng/yaw/vị trí, chơi lại không tải hoặc nhân đôi mesh, nhảy khỏi máy bay, fallback HTTP 404 và màn hình touch ngang. Ảnh ở `output/playwright/aircraft-desktop.png` và `aircraft-touch.png`. Đây là máy bay phản lực tĩnh; bánh đáp và các bề mặt điều khiển giữ theo model gốc, chưa có animation thu càng.

Các kết quả đã loại khỏi đề xuất: bản C-130 scan của Kaarta có 25,3 triệu điểm; bản low-poly C-130 của samanthacford không có tùy chọn tải trên listing; model Free3D CargoPlaneLargeSizeUSA ghi Personal Use License.
