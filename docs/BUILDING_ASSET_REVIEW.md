# Rà soát asset building có sẵn

Đối chiếu ngày 07/10/2026 với thư viện nguồn, ảnh Preview và hình học GLB tại `assets-source/free-buildings/`. Thư viện hiện có 16 gói, 1.429 GLB; các gói giữ giấy phép Kenney CC0 tại chỗ.

## Những gói phù hợp với nhà hiện tại

| Gói | GLB | Điểm có thể áp dụng |
| --- | ---: | --- |
| Building Kit | 79 | Cột có chân/đầu cột, máng thoát nước, tường có lỗ cửa, góc tường, cầu thang |
| Modular Buildings | 108 | Mái hiên, cửa sổ mái, ban công, mặt tiền chia ô, thiết bị AC, mái nối góc |
| City Kit — Suburban | 40 | Hình khối nhà chữ L, nhà hai tầng lệch khối, gara, mái giao nhau, hàng rào |
| City Kit — Commercial | 41 | Mặt tiền nhà phố, mái che cửa hàng, khối cao tầng có tầng đế |
| City Kit — Industrial | 37 | Ống khói, kho, bồn chứa, thiết bị trên mái |
| Furniture Kit | 140 | Bếp, tủ, sofa, bàn ghế và giường để phân biệt chức năng phòng |

Factory, Roads, Survival và Space Station bổ sung nhà xưởng, hạ tầng đường phố, công trình tạm và hầm; chưa cần đưa thêm các model này vào nhà dân trong đợt này.

## Đã tích hợp từ thư viện

| Model nguồn | Asset runtime | Sử dụng |
| --- | --- | --- |
| Building Kit / column.glb | k-column.glb | Thay cột hộp ở hiên bằng cột có chân và đầu cột |
| Building Kit / gutter-vertical.glb | k-gutter-vertical.glb | Ống thoát nước tại góc dưới mép mái |
| Modular Buildings / roof-flat-awning-a.glb | k-roof-flat-awning-a.glb | Mái hiên có viền; xoay theo hướng cửa |
| Modular Buildings / detail-ac-a.glb | k-detail-ac-a.glb | Thiết bị trên mặt tiền một số nhà, nằm cao hơn đường đi |
| City Kit — Industrial / chimney-small.glb | k-chimney-small.glb | Ống khói có tạo hình thay cho khối hộp trên mái |

Năm GLB mới tổng cộng **82.148 byte** sau khi nhúng texture. Chỉ model được chọn vào `public/assets/coverage/`; cả thư viện nguồn không đi vào bản build. Script `scripts/prepare-coverage-assets.py` tái tạo asset, SHA-256 và manifest nguồn. Attribution và giấy phép Modular Buildings đã được bổ sung.

Năm chi tiết dùng màu trung tính để hòa với tường và mái hiện tại; texture màu gốc được bỏ ở vật liệu runtime, còn GLB nguồn được giữ nguyên.

Các chi tiết chỉ dùng ở chunk gần và được gộp mesh theo vật liệu. Mái hiên/cột dùng đúng footprint va chạm đã có; ống nước và AC là chi tiết nhỏ đặt tại góc tường hoặc phía trên lối đi. Khi model cột, mái hiên hoặc ống khói tải lỗi, hình học dự phòng tiếp tục dựng được nhà.

## Hướng phát triển từ các mẫu nguyên căn

Suburban là tham chiếu tốt cho nhà hai tầng lệch khối, mái giao nhau và gara. Mẫu nguyên căn chưa được thay trực tiếp vào nhà có thể đi vào: vị trí cửa, cửa sổ và cầu thang phải khớp va chạm và loot trước.

Tường có cửa/cửa sổ của Building Kit cần lắp thành từng module theo kích thước lỗ mở thật. Không co một tấm có lỗ mở thành từng đoạn tường đặc vì sẽ tạo lỗ mở phụ hoặc sai vị trí. Cửa sổ rời của Modular Buildings cũng cần kiểm tra mặt kính và tia bắn trước khi thay khung cửa hiện tại.

Các bước mở rộng hợp lý: nhà hai tầng có cầu thang thật; góc mái giao nhau không có mặt tam giác chắn bên trong; ban công có sàn/lan can; thêm bếp và phòng khách dựa trên Furniture Kit.

## Kiểm tra

- Kiểm tra GLB, texture nhúng, kích thước file và SHA-256 bằng bộ test coverage-files.
- Kiểm tra các model tải được trong gallery trên Edge.
- Kiểm tra năm chi tiết xuất hiện trong chunk nhà; thử lỗi tải của cả năm model để xác nhận hình học dự phòng.
- Bộ test houses kiểm tra đường đi từ hiên tới loot, các hướng đặt nhà và sân khuyết của nhà chữ L.

## Đã tải và áp dụng thêm ngày 07/10/2026

Sáu gói mới: Fantasy Town (167 GLB), Castle (76), Pirate (72), Retro Urban (124), Graveyard (91), Modular Dungeon (39). Tổng 569 GLB; số thực tế được kiểm tra từ archive thay vì cộng số quảng bá trên website.

| Model runtime mới | Áp dụng |
| --- | --- |
| k-urban-wall / k-urban-roof | Tường gạch lắp theo đoạn 4 m và mái kim loại cho một nhóm nhà |
| k-timber-wall / k-town-roof / k-hip-roof | Khung gỗ, mái hai phía và mái bốn phía |
| k-mill-blades | Cánh cối xay trên mặt hồi một nhóm nhà ở hamlet; cánh là chi tiết tĩnh |
| k-town-fountain | Đài nước ở thành phố/thị trấn |
| k-crypt-small / k-crypt-roof / k-crypt-door | Nhà tưởng niệm lắp thân/mái, cửa đặt ở vị trí mở; có lối đi vào |
| k-obelisk | Bia tưởng niệm |
| k-water-tower | Tháp nước gần thị trấn/nông trại; giữ lối đi giữa chân trụ |
| k-scaffold | Khung công trình tại thành phố; phần giữa đi qua được |
| k-castle-wall / k-fort-wall | Tường bao căn cứ và sân đá có cổng mở |
| k-dungeon-wall | Tường hầm, giữ nguyên các khoảng cửa trong dữ liệu va chạm |

16 GLB tăng 693.764 byte cho runtime. Toàn bộ coverage hiện có 70 GLB / 7.863.890 byte bao gồm ảnh và âm thanh. Nguồn và giấy phép sáu gói đã có trong manifest, file License và credit trong game.

Số công trình phụ mới: island 49, valley 22, desert 48, pines 51, metro 38. Đặt bằng thuật toán riêng, tránh đường, nước, vật cản và loot; không thêm điểm loot mới. Gói nguồn ngoài public, chỉ model được chọn đi vào bản build.

Mái kim loại được bổ sung mặt hồi; mái bốn phía bỏ các chi tiết dành cho mái hai phía và giữ silhouette ở xa. Loader sao chép dữ liệu vertex và chỉ số của từng primitive, đồng thời chụp ma trận trước khi bake, để dữ liệu GLTF dùng chung không bị biến đổi hai lần; gallery kiểm tra min/max của mọi template đều nằm trong unit box.

Kiểm tra cuối: TypeScript và production build thành công; 752 unit test đạt; 6 kiểm thử Edge đạt, gồm tải đủ 70 model, kích thước chuẩn hóa, xe/bánh xe, nhà và sáu loại landmark khi tải thành công hoặc bị chặn. Ảnh xác minh: `output/playwright/house-wing-preview.png`.
