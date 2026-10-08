# Dung lượng gameplay WebRTC

Gameplay dùng codec trong `src/net/wire.ts`; Supabase chỉ giữ phòng chờ và handshake. Host tạo snapshot riêng cho từng người nhận. Chuyển động trên đường truyền bình thường vẫn dùng 15–20 snapshot/giây.

## Dữ liệu gửi đi

- Mỗi frame bắt đầu bằng `LL`, wire version `3` và loại frame: message thường, snapshot đầy đủ, delta hoặc fragment. Phòng chờ từ chối phiên bản khác; cả nhóm cần tải lại sau deploy.
- Chuỗi UTF-8, số nguyên varint, số được game làm tròn đến 0,001 dùng fixed point nếu biểu diễn lại chính xác; số khác dùng float64. Không giảm độ chính xác vị trí/góc quay. Các tên trường thông dụng dùng dictionary.
- Delta và sequence baseline độc lập trên **từng peer**. Hàng số actor/xe dùng bitmask. Decoder khôi phục snapshot đầy đủ trước khi đưa cho `ClientSession`.
- Inventory, đạn, vật phẩm, bài tập Trường bắn và echo input chỉ gửi cho chủ nhân. `pub` giữ danh sách súng của người khác để vẽ trang bị. Hàng human, tên, điểm, trạng thái nhảy dù và số người/bot còn sống vẫn đồng bộ toàn phòng.
- Bot/xe được gửi quanh chính người nhận hoặc nhân vật họ đang spectate. Bán kính vào vùng là 420 m, ra vùng 460 m để tránh nhấp nháy ở ranh giới; luôn gửi xe của người nhận/người đang được xem. Render bot vốn giới hạn 340 m và xe 380 m. Host chỉ cho người đã bị hạ đổi nhân vật quan sát.
- Các hàng không còn thuộc view được đánh dấu `netVisible = false` trên mirror. Khi quay vào vùng, nhận trạng thái mới và bỏ các pose nội suy cũ trước khi hiện lại. Visibility mạng độc lập với bia bật lên/ẩn xuống và trạng thái sống/chết. Đối tượng chưa đồng bộ không tham gia raycast dự đoán, nhặt xe hay hỗ trợ ngắm.
- Mỗi người nhận có lịch sử loot riêng. Khi chậm mạng, builder chưa tiến sequence hoặc đánh dấu loot đã gửi. Khi reconnect, gửi đầy đủ loot, trạng thái riêng và view hiện tại.
- Khi nhặt một phần chồng đồ, gửi hàng loot có nội dung thay đổi, kể cả đồ sinh sẵn từ seed. Mỗi 50 snapshot xác nhận lại các hàng seed từng thay đổi cùng với đồ thả động; không gửi lại toàn bộ loot của bản đồ.
- Gói đầu, sau resync, sequence reset và mỗi tối đa 50 snapshot là gói đầy đủ. Nếu delta lớn hơn gói đầy đủ thì gửi đầy đủ. Thiếu baseline yêu cầu `rtc-resync` qua DataChannel.
- Loot, sự kiện, khói, lửa và projectile được khôi phục đầy đủ theo snapshot nhận được; các mảng rỗng/xóa trường không tự phát lại sự kiện cũ. Lệnh bắn/nhặt/thả và chat tiếp tục dùng DataChannel đáng tin cậy, theo thứ tự.
- Gói lớn được chia thành fragment nhị phân, header 16 byte, tối đa 8 KiB payload/fragment và giới hạn SCTP. Không JSON/base64. Mỗi peer giữ một assembly tối đa 256 KiB.
- Decoder giới hạn kích thước, số node, độ sâu và từ chối gói malformed/prototype keys. Trạng thái khôi phục cũng phải nằm trong giới hạn frame đầy đủ.

## Input và nghẽn mạng

Client thực sự đứng yên trên mặt đất, không đổi hướng nhìn hoặc thao tác, gửi heartbeat **4 Hz**. Di chuyển, dừng, xoay camera hoặc đổi người xem được gửi trong khoảng 50 ms; bắn, lệnh và nhảy trong khoảng 40 ms. Khi di chuyển/nhảy dù/lái xe, nhịp input thường vẫn là 10–20 Hz. Heartbeat này không thay đổi thời hạn phát hiện mất kết nối 3 giây.

Host kiểm tra `snapshotReady` trước khi build cho từng peer:
- Queue dưới 4 KiB: nhịp snapshot bình thường.
- Queue từ 4 KiB: tối đa 10 Hz; từ 8 KiB: tối đa 5 Hz.
- Queue từ 16 KiB: giữ snapshot mới đến khi queue giảm.

Các khách khác tiếp tục bình thường. Trong thời gian giữ, sự kiện cần giao như hạ gục/nhặt đồ được giữ; hiệu ứng/âm thanh shot đã cũ được bỏ để tránh phát dồn khi hết nghẽn. Không encode rồi bỏ một delta đã tiến baseline. Dữ liệu trạng thái được build mới khi gửi, thay vì xếp các snapshot cũ vào hàng đợi. Kết quả trận có số lần gửi cuối riêng từng khách; khách nghẽn vẫn nhận kết quả sau khi đường truyền phục hồi. Mức giới hạn cứng 512 KiB vẫn là hàng rào cuối cho kết nối không thể gửi.

Các ngưỡng queue là giới hạn dữ liệu chờ trong trình duyệt, không phải phép đo băng thông hay quota TURN. Giảm payload/hàng đợi có thể giảm lag khi nghẽn; không làm thay đổi độ trễ vật lý của đường truyền.

## Chạy phép đo

```sh
npm run net:measure
```

Script chạy 15 giây mỗi cấu hình, seed 9123, cấp lệnh di chuyển cho **mọi human**, bot hoạt động. So sánh JSON, bản nhị phân/delta gửi view toàn phòng trước đây và view riêng hiện tại trên cùng mô phỏng. Mỗi guest có builder/encoder/decoder riêng; từng gói mới được kiểm tra giải mã đúng thông điệp đã gửi. Cộng input tiêu chuẩn khi đang di chuyển theo tần suất hiện hành. Không mở kết nối Supabase/TURN, không dùng quota.

Số đo trên máy phát triển 2026-10-08, kB/s trung bình mỗi cặp host–guest, gồm snapshot và input:

| Cấu hình thực tế | Nhị phân/delta view toàn phòng | View riêng hiện tại | Giảm thêm |
| --- | ---: | ---: | ---: |
| Sân tập nhỏ, 2 người + 6 bot | 5,86 | 5,90 | -0,59% |
| Sân tập nhỏ, 6 người + 2 bot | 5,15 | 4,45 | 13,52% |
| Thung lũng, 6 người + 100 bot | 37,38 | 24,02 | 35,73% |
| Đảo, 6 người + 100 bot | 14,46 | 6,22 | 57,01% |
| Đảo, 2 người + 100 bot | 8,44 | 6,57 | 22,08% |
| Trường bắn, 6 người + 10 bot + 55 bia | 10,43 | 9,60 | 7,94% |

Sân tập nhỏ giới hạn tổng actor ở 8. View riêng có chi phí metadata; phòng nhỏ hai người không có nhiều dữ liệu dư để giảm nên payload trong phép đo tăng khoảng 0,04 kB/s. Lợi ích chính nằm ở phòng đông và bản đồ rộng. Các người chơi đứng gần nhau, cảnh nhiều hiệu ứng hoặc đường gửi bị điều tiết sẽ cho số khác.

Các số là **payload ứng dụng**, có header fragment; chưa tính UDP/TCP, DTLS, SCTP/ACK, ping, ICE, truyền lại hay cách Metered cộng lưu lượng gửi/nhận. Không suy trực tiếp số giờ chơi của quota 20 GB từ bảng này. Cần đối chiếu dashboard TURN khi chơi trên mạng thật. Phép đo đang di chuyển không cộng lợi ích của heartbeat 4 Hz lúc đứng yên.

## Kiểm thử

- `tests/net-interest.test.ts`: quyền sở hữu inventory, public weapons, view riêng, history loot độc lập, hysteresis, ẩn/hiện và xóa pose cũ, spectate, idle input/thao tác nhanh, giữ sự kiện khi nghẽn, kết quả trận sau nghẽn.
- `tests/net-wire.test.ts`: số/Unicode, delta, loot/events một lần, xóa trường, baseline, phân mảnh và gói malformed.
- `tests/webrtc.test.ts`: codec riêng từng peer, resync, từ chối bản cũ, queue điều tiết từng peer và giao critical traffic.
- `tests/net-session.test.ts`: di chuyển, bắn, nhảy, lái xe và đối chiếu dự đoán khi trễ/jitter/mất gói.
- `tests/e2e/webrtc.e2e.ts`: native WebRTC 6 người và game thật, gameplay nhị phân/delta khi signaling đóng; thêm view riêng trên Đảo, spectate và giữ hạ gục trong tình huống queue giả lập.
- `tests/e2e/range-multiplayer.e2e.ts`, `tests/e2e/chat-reconnect.e2e.ts`: kho súng/bài tập/hồi sinh riêng, chat và reconnect trong game thật với nhiều trình duyệt, gồm giao diện điện thoại.
