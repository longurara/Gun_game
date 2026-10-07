# Dung lượng gameplay WebRTC

Gameplay dùng codec trong `src/net/wire.ts`; Supabase chỉ giữ phòng chờ và handshake.
Tần suất snapshot/input trong `netRates()` và logic mô phỏng không thay đổi.

## Dữ liệu gửi đi

- Mỗi frame bắt đầu bằng `LL`, wire version `2` và loại frame: message thường, snapshot đầy đủ, delta hoặc fragment.
- Chuỗi UTF-8, số nguyên varint, số đã được game làm tròn đến 0,001 dùng fixed point nếu biểu diễn lại chính xác; số khác dùng float64. Không làm tròn thêm vị trí hoặc góc quay. Các tên trường thông dụng dùng dictionary cố định.
- Delta so với snapshot trước trên **từng peer**, gồm trường thay đổi và trường bị xóa. Các hàng số của actor/xe dùng bitmask. Mỗi delta chỉ rõ sequence baseline; decoder khôi phục snapshot đầy đủ trước khi đưa cho `ClientSession`.
- Loot, sự kiện, khói, lửa và projectile vẫn được khôi phục đầy đủ cho mỗi snapshot, kể cả khi một mảng trở về rỗng. Delta không tự phát lại sự kiện từ snapshot trước.
- Gói đầu, sau yêu cầu resync, sau sequence reset và mỗi tối đa 50 snapshot là gói đầy đủ. Nếu delta lớn hơn snapshot đầy đủ thì gửi đầy đủ. Thiếu baseline sẽ bỏ delta đó và yêu cầu `rtc-resync` trên DataChannel.
- Gameplay tiếp tục dùng DataChannel đáng tin cậy, theo thứ tự. Những lệnh bắn/nhặt/thả đồ không chuyển sang kênh có thể mất gói.
- Gói lớn được chia thành fragment nhị phân có header 16 byte, tối đa 8 KiB payload mỗi fragment, giới hạn theo SCTP. Không chuyển sang JSON/base64. Mỗi peer chỉ giữ một assembly tối đa 256 KiB.
- Decoder giới hạn kích thước, số node và độ sâu; từ chối gói bị cắt, chỉ số/bitmask sai, frame sai phiên bản và các khóa có thể sửa prototype. Trạng thái khôi phục cũng phải nằm trong giới hạn frame đầy đủ.

Các bản dùng wire version khác sẽ nhận thông báo tải lại game ngay trong phòng chờ. Cả nhóm cần tải lại sau deploy rồi tạo phòng mới.

## Chạy phép đo

```sh
npm run net:measure
```

Script chạy 15 giây mô phỏng mỗi cấu hình, seed 9123, cho chủ phòng di chuyển và bot hoạt động. Các người chơi khác đứng yên trong mô phỏng; script cộng các gói input tiêu chuẩn ở tần suất hiện hành. Gói trước/sau lấy từ cùng snapshot và được kiểm tra giải mã bằng nhau. Không mở kết nối mạng, không dùng quota TURN.

Số đo mẫu trên máy phát triển, 2026-10-07, gồm snapshot và input cho mỗi cặp host–guest:

| Cấu hình thực tế | JSON trước (kB/s) | Nhị phân + delta (kB/s) | Giảm payload |
| --- | ---: | ---: | ---: |
| Sân tập nhỏ, 2 người + 6 bot | 23,16 | 5,56 | 75,98% |
| Sân tập nhỏ, 6 người + 2 bot | 34,04 | 4,38 | 87,13% |
| Đấu trường, 6 người + 100 bot | 115,73 | 36,29 | 68,64% |
| Đảo, 6 người + 100 bot | 65,21 | 12,78 | 80,41% |
| Đảo, 2 người + 100 bot | 32,90 | 7,71 | 76,56% |

Sân tập nhỏ giới hạn tổng số actor ở 8 nên số bot thực tế khác cấu hình đầu vào. Script in cả `actualHumans`, `actualBots`, số actor trung bình gửi trong snapshot và thời gian encode/decode. Codec cho trận đấu trường 100 bot tốn khoảng 0,29 ms encode và 0,25 ms decode mỗi snapshot trên máy đo; encode được thực hiện riêng cho mỗi peer. Đây không phải số đo hiệu năng trên điện thoại.

Các số này là **payload ứng dụng**, có header fragment nhưng chưa có UDP/TCP, DTLS, SCTP/ACK, ping, ICE, truyền lại hoặc cách Metered cộng lưu lượng gửi/nhận. Không suy trực tiếp số giờ chơi của quota 20 GB từ bảng này. Trận dài hơn, nhiều người cùng di chuyển/bắn hoặc nhiều đối tượng cùng đổi trạng thái sẽ có kết quả khác; dung lượng TURN thực tế cần đối chiếu dashboard.

## Kiểm thử

`tests/net-wire.test.ts` kiểm tra số/Unicode, delta khi actor đổi thứ tự, loot và sự kiện một lần, xóa trường, reset baseline, quyền sở hữu baseline, phân mảnh và gói malformed. Snapshot thật có di chuyển/giao tranh/nhảy dù được so sánh nguyên vẹn trước/sau.

`tests/webrtc.test.ts` kiểm tra baseline độc lập theo peer, yêu cầu resync qua DataChannel và từ chối phiên bản cũ. `tests/e2e/webrtc.e2e.ts` dùng native WebRTC với 6 người và game thật qua Supabase SDK giả lập signaling; xác nhận kênh gameplay gửi ArrayBuffer/delta, di chuyển và thao tác hoạt động sau khi signaling đóng.
