# Tối ưu súng ở trường bắn

Bãi đồ nhặt có 214 vật phẩm trong cấu hình đo. Trước đây mỗi tên súng tạo một mesh gộp riêng dù nhiều tên dùng cùng một asset GLB. Mesh gộp vẫn có nhiều submesh/vật liệu, nên không tương đương một lượt vẽ. Tất cả vật phẩm còn cập nhật xoay và nhấp nhô ở mỗi khung hình.

## Cách dựng hiện tại

- Model đầy đủ được chia sẻ theo các mesh nguồn thực tế và cấp màu vòng đánh dấu. Súng khác tên nhưng cùng asset/cấp màu dùng chung batch; model dự phòng riêng vẫn giữ đúng hình dáng riêng.
- Trong trường bắn, súng xa dùng silhouette theo lớp súng và cấp màu, tối đa 300 vertex, một vật liệu dùng màu vertex, không texture. Vòng đánh dấu xa là vành phẳng thay vì torus.
- Khoảng cách trở về model đầy đủ: 12 m ở chế độ thấp, 20 m ở chế độ cao, 10 m trên thiết bị cảm ứng. Model đầy đủ được giữ thêm 3 m để tránh chuyển qua lại liên tục tại ranh giới.
- Vật phẩm được chọn luôn trở về model đầy đủ ngay, kể cả giữa hai lần quét. Model xa đứng yên và khóa world matrix; model gần vẫn xoay/nhấp nhô.
- Tất cả vật phẩm vẫn dùng dữ liệu loot và thao tác nhặt hiện có. Súng đang cầm và súng xa trên các bản đồ khác không dùng silhouette này.

## Đo trước/sau

Edge headless trên máy phát triển, viewport 1280 × 720, chế độ thấp, trường bắn không bot, người chơi ở `(0, 0, -155)` nhìn về bãi súng với yaw `π`, pitch `-0.32`. Chờ 5 giây rồi lấy 80 khung hình. Số lượt vẽ được tính từ chênh lệch bộ đếm engine chia cho số khung hình, tránh nhầm bộ đếm tích lũy thành số lượt vẽ mỗi khung.

| Chỉ số | Trước | Sau |
| --- | ---: | ---: |
| Lượt vẽ toàn cảnh mỗi khung hình | 787,06 | 176,75 |
| Index đang vẽ toàn cảnh | 1.171.758 | 352.794 |
| Mesh mẫu cho loot | 214 | 85 |
| Vertex trong mesh mẫu cho loot | 629.714 | 112.661 |
| Vật phẩm đang tồn tại trong scene | 214 | 214 |
| Vật phẩm trong vùng nhìn tại lúc đo | 146 | 146 |
| Thời gian khung hình trung vị | 26,7 ms | 9,6 ms |

Lượt vẽ giảm khoảng 77,5%, lượng index đang vẽ giảm khoảng 69,9%. Đây là phép so sánh tại cùng góc nhìn trên máy phát triển; thời gian khung hình trên máy người chơi còn phụ thuộc GPU, độ phân giải và góc nhìn. Các model gần vẫn dùng vật liệu gốc nên chi phí tăng khi đi vào giữa bãi súng.

## Xác minh

- 383 kiểm thử liên quan đến vũ khí, trường bắn, hình học và gộp mesh đều qua.
- `tests/e2e/loot-detail.e2e.ts` chạy game thật: đủ đồ nhặt, chia sẻ mesh, proxy không texture/ít vertex, chuyển gần–xa–gần, chọn và nhặt súng bằng phím E, không làm thay đổi geometry nguồn.
- TypeScript và production build qua. Các số đo và ảnh trước/sau được lưu trong thư mục `output/` của máy phát triển.

Chạy hồi quy trình duyệt bằng `npx tsx --test tests/e2e/loot-detail.e2e.ts`.
