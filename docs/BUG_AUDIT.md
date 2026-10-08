# Rà soát và sửa lỗi multiplayer — 2026-10-08

Phạm vi: phiên bản gồm tối ưu mạng theo vùng quan sát. Tập trung vào reconnect, kết thúc trận, trường bắn, đồng bộ đồ và thống kê; chưa phải kiểm tra toàn bộ đồ họa/gameplay.

## Các lỗi đã sửa

### Hồi sinh khi offline làm mất bảo vệ 30 giây

Nếu mất kết nối khi đang chết tại trường bắn, cờ bảo vệ trước đây bị xóa vì nhân vật chưa sống. Khi hồi sinh sau hai giây, nhân vật vẫn offline nhưng có thể chịu sát thương.

`GameSimulation.setReconnecting` hiện giữ cờ theo trạng thái kết nối, kể cả khi nhân vật chết. Hồi sinh giữ bảo vệ đến lúc resume; hết hạn hoặc chủ động rời phòng vẫn xóa cờ và loại nhân vật. Kiểm thử bao gồm máu, giáp, reconnect sau hồi sinh và không hồi sinh lại sau khi hết 30 giây.

### Reconnect giả khi đã kết thúc trận

Host dừng gửi snapshot sau sáu lần gửi kết quả. Client trước đây vẫn coi ba giây im lặng là rớt mạng: ca tái hiện gọi reconnect ở 3350 ms dù đường truyền bình thường.

Sau khi nhận kết quả, client không dùng khoảng cách giữa snapshot để suy ra mất mạng. Vẫn gửi heartbeat input để host giữ kết nối/chat và vẫn xử lý lỗi/đóng transport thực tế. Kiểm thử giữ màn hình kết quả 36 giây, sau đó thử mất kết nối và đóng phòng thật.

### Nhặt một phần chồng đồ không cập nhật số lượng còn lại

Host còn ba băng gạc nhưng khách vẫn thấy bốn, kể cả sau 150 snapshot. Snapshot chỉ biết loot mới và loot bị lấy hết; các hàng sinh từ seed không được xác nhận lại nội dung thay đổi.

Builder hiện theo dõi số lượng/đạn đã nạp/độ bền của mỗi hàng. Gửi ngay hàng thay đổi cho từng khách và xác nhận lại hàng seed từng đổi mỗi 50 snapshot. Không gửi lại toàn bộ loot sinh sẵn. Kiểm thử bao gồm chồng đồ ban đầu, đồ thả động, mất bản cập nhật đầu, lấy hết chồng đồ và full resync.

### Thống kê trúng/hạ bia bị cộng hai lần trên khách

Kiểm thử bằng ba trình duyệt thật ghi nhận một lần trúng và một lần hạ bia bị cập nhật thành hai. Client nhận thống kê trường bắn từ snapshot riêng, rồi cộng thêm lúc xử lý sự kiện shot/kill.

Với trường bắn, phần xử lý sự kiện hiện dùng thống kê có thẩm quyền từ host. Hiệu ứng bắn, âm thanh, thông báo và kill feed vẫn xử lý bình thường. Kiểm thử trình duyệt theo dõi từng lần ghi bộ đếm, nên bắt được cả lỗi tăng tạm thời trước snapshot kế tiếp.

## Vòng rà soát tiếp theo

### Reconnect báo đã nối lại nhưng vẫn giữ vị trí/góc nhìn cũ

Gói resume khôi phục vị trí đối tượng khác nhưng bỏ qua vị trí của chính client; reconcile cũng bị bỏ qua ở gói này. Ca tái hiện giữ nhân vật tại `(20, 10, 30)` dù host đã gửi `(-60, 0, -22)`, cho đến lúc có snapshot thường tiếp theo.

Client hiện áp dụng ngay vị trí và yaw của bản thân khi nhận resume, trước khi cho người chơi điều khiển. Kiểm thử kiểm tra ngay sau gói resume, không dựa vào snapshot tiếp theo, và bao gồm cả lái xe.

### Đà nhảy/vượt vật cản cũ tiếp tục chạy sau reconnect

Vận tốc nhảy trên bộ không được khôi phục khi resume. Nhân vật đã tiếp đất trên host vẫn bật lên lại trên client; ca tái hiện tăng độ cao 0,203 m ở frame đầu dù không nhấn nhảy. Một animation vượt vật cản đang dang dở cũng có thể kéo người chơi trở lại vị trí cũ.

Resume hiện khôi phục vận tốc và tốc độ, hủy vault bị ngắt và xóa trạng thái giữ nút nhảy cũ. Snapshot thường vẫn giữ dự đoán nhảy để tránh giật khi có ping.

### Tổng hạ gục trong trận thường không được sửa sau reconnect

Snapshot mang tổng số kill của nhân vật, nhưng HUD trận thường chỉ cộng từ sự kiện kill. Nếu sự kiện đã mất lúc ngắt kết nối, resume có thể mang số đúng `5` trong khi HUD vẫn giữ `1`.

Tổng hạ gục trên HUD hiện lấy từ hàng human có thẩm quyền trong mọi loại trận. Phần hiệu ứng không cộng thêm từ kill echo nữa, nên cũng không đếm hai lần. Kiểm thử gồm resume không có sự kiện, snapshot lặp lại và một kill thật sau reconnect qua native WebRTC.

### Không xem được đồng đội còn ở trên máy bay/đang nhảy dù

Danh sách spectate trước đây loại mọi actor có trạng thái bay, bao gồm người chơi. Nếu tất cả đồng đội sống còn đang ở trên không, người bị hạ không có ai để xem.

Người chơi còn sống hiện được chọn ở mọi trạng thái bay; bot vẫn cần view hiện tại và ở gần người sống. Kiểm thử bao gồm máy bay, rơi tự do, dù và giao diện spectate đồng đội đang có dù qua WebRTC.

### Spectate có thể chọn bia đang ẩn

Bia bật lên/ẩn xuống có thể còn sống khi đang ẩn. Danh sách cũ không kiểm tra cờ `hidden`, nên camera có thể chuyển đến một bia không hiển thị.

Danh sách hiện bỏ qua bot/bia ẩn và giữ các kiểm tra visibility/khoảng cách. Kiểm thử dùng bia thực của trường bắn và xác nhận nó được chọn lại sau khi hiện lên.

## Kiểm thử hồi quy

- `tests/reconnect.test.ts`: bảo vệ khi hồi sinh offline, resume/expiry, kết quả trận và lỗi transport thật.
- `tests/net-interest.test.ts`: nội dung loot thay đổi, các khách độc lập, xác nhận lại khi mất cập nhật và codec.
- `tests/e2e/range-multiplayer.e2e.ts`: thống kê qua giao diện/game thực với native WebRTC.
- `tests/e2e/chat-reconnect.e2e.ts`: chat, reconnect và khách khác tiếp tục chơi.
- `tests/net-resume-state.test.ts`: vị trí/yaw, vận tốc, vault bị ngắt, xe và tổng kill có thẩm quyền.
- `tests/net-spectate.test.ts`: người chơi đang bay, bia ẩn và view bot hợp lệ.
- `tests/e2e/squad-drop.e2e.ts`: điều khiển nhảy dù theo đội, tách đội và spectate người dẫn đang bay.

Kết quả xác minh sau vòng tiếp theo: 819/819 kiểm thử unit qua; ba bài kiểm thử multiplayer trên trình duyệt (chat/reconnect, trường bắn và nhảy dù theo đội/spectate) đều qua; build thành công. Bài nhảy dù đã cập nhật allowlist để chấp nhận `rtc-reconnect`, vốn là signaling hợp lệ, đồng thời kiểm tra gameplay và reconnect ticket không đi qua signaling. `npm run net:measure` ở vòng sửa trước giải mã đúng mọi gói trong sáu cấu hình và giữ các mức dung lượng đã đo trước đó. Các kiểm thử trình duyệt dùng handshake giả lập và DataChannel WebRTC thật trên máy phát triển, không xác minh đường TURN giữa hai mạng bên ngoài.
