# Asset coverage — LASTLIGHT

Cập nhật **06/10/2026** sau khi áp dụng bộ asset bổ sung. Kiểm kê trước đó nằm trong lịch sử Git ở commit `604fa94`. Các nhóm thiếu chính đã được nâng cấp trong runtime; model tải chậm hoặc lỗi vẫn có hình dự phòng.

## Đã áp dụng

| Nhóm | Trạng thái hiện tại |
| --- | --- |
| Xe | 9 loại có GLB: ô tô, coupe, pickup, van, minibus, jeep, buggy, xe máy, tay ga. Quad, tuk-tuk và sidecar giữ khung xe riêng, thêm bánh Kenney và texture kim loại/vải/cao su. Model xe tải xong tự thay hình dự phòng; vẫn theo hull, độ nghiêng địa hình và trạng thái hư hỏng hiện có. |
| Đồ nhặt / giáp | Ba lô, túi cứu thương, băng gạc, lon nước, chai thuốc, Molotov, lựu đạn, scope và suppressor có GLB. Đạn dùng hộp Kenney và nhãn riêng. Mũ/áo giáp có texture, vành, visor, túi, dây và tấm giáp; phụ kiện còn lại dùng hình riêng đã thêm vật liệu bề mặt. |
| Cận chiến | GLB riêng cho chảo, dao rựa, xà beng, liềm. |
| Nỏ / súng phóng | GLB cho nỏ, M-79 và Panzerfaust; dùng chung cho biến thể cùng lớp, căn theo trục bắn và vị trí lóe đầu nòng. Súng đang cầm được cập nhật khi model tải xong. |
| Dù / tiếp tế | GLB dù parafoil có dây, thùng Kenney; flare dùng sprite alpha đỏ. |
| Khói / lửa / nổ / lóe | 5 sprite PNG có alpha thật, billboard theo camera, dùng chung texture/material và tách alpha của hiệu ứng cần fade. |
| Công trình đảo | Chọn 14 GLB từ thư viện 860 file: tường/sàn, bàn/ghế/giường/tủ, container, bồn, ống khói, ống dẫn, thùng và rương. Gắn vào footprint có sẵn, giữ các khoảng trống cửa/cửa sổ và cầu thang theo dữ liệu world. Không thêm vật cản ngoài gameplay. |
| Cây / đá | 3 GLB Kenney; giới hạn 16 cây chi tiết/chunk, xa dùng foliage cũ. Công trình nhập chỉ dùng ở các chunk gần; geometry gộp theo material. |
| Đấu trường / phòng tập | Áp dụng bộ texture có sẵn cho bê tông, đất/cỏ, nhựa đường, mái, đá, vỏ cây, kim loại, gỗ và vải. |
| Bầu trời / nước | Skybox Kenney cho đảo và bản đồ phẳng; nước thêm ảnh chi tiết sóng tạo bằng mã, cuộn cùng normal map hiện có. |
| Âm thanh | 22 file bổ sung: bước chân/bề mặt, reload theo nhóm súng, động cơ loop theo tốc độ, gió, vải/dù, cửa hầm, va chạm, cận chiến, ném, hồi máu, khói/lửa/nổ, âm nền hầm, nước nhỏ giọt và thở. Dùng cùng master volume, stereo/reverb, pause/dispose và fallback tổng hợp. |
| Giấy phép | CC0 hoặc CC BY 3.0, tác giả/nguồn/biến đổi ghi trong menu **NGUỒN ASSET**, CREDITS và manifests có SHA-256. |

Bộ bổ sung gồm **49 GLB, 6 PNG, 22 OGG**, khoảng **6,76 MiB** dữ liệu runtime. Không đưa toàn bộ archive nguồn vào bản build.

## Phạm vi hình dựng bằng mã còn giữ

- Mũ, áo giáp, một số phụ kiện và ba khung xe đặc biệt dùng geometry riêng đã nâng cấp texture/chi tiết; không phải tất cả đều có GLB tải ngoài.
- Súng phổ thông vẫn dùng bộ 13 GLB theo lớp và phong cách; chưa có hình dáng chính xác riêng cho mọi tên súng trong arsenal.
- Công trình cao tầng, mái dốc, bậc thang, đường và hàng rào giữ geometry tương thích dữ liệu bản đồ, với texture đã áp dụng. Chỉ dùng các model nguồn phù hợp footprint và khả năng nhận diện.
- Nước có albedo/normal tạo bằng mã; chưa dùng bộ PBR/foam ảnh chụp tải ngoài. Nhạc menu tiếp tục là bản tổng hợp hiện có.
- HUD SVG, vòng loot, tracer, collision và hình ở xa là geometry chức năng; không cần thay bằng model tải ngoài.

## Kiểm chứng

- `npm test`: 747 test qua.
- Build TypeScript/Vite thành công (`output/build-coverage` trong lần kiểm tra này).
- Test trình duyệt kiểm tra cả 49 model, cache geometry, nỏ tải chậm, alpha thực của sprite, 12 loại xe và trường hợp download lỗi, streaming công trình/skybox.
- Hồi quy riêng máy bay, súng, quân địch và menu; ảnh chụp kiểm tra nằm trong `output/playwright/` (không đưa vào runtime).
- Đây là kiểm tra tự động trên Edge headless; chưa đo FPS hay benchmark trên thiết bị điện thoại thật.

Cách tái tạo và sơ đồ tích hợp: [FREE_COVERAGE_ASSETS.md](FREE_COVERAGE_ASSETS.md). Nguồn từng file: [CREDITS](../public/assets/coverage/CREDITS.md).
