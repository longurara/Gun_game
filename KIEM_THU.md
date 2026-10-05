# Báo cáo kiểm thử LASTLIGHT

Ngày: **05/10/2026**. Phạm vi: bản single player trên web với **8 loại súng và scope 4×/6×/8×**, chạy tại localhost.

## Kiểm thử tự động

- `npm test`: **52 kiểm thử vượt qua**. Bao gồm nhặt và nạp đúng đạn cho từng súng, tầm bắn/nhịp bắn, sát thương thân/đầu, độ chính xác khi ngắm, vật cản, đồ rơi và reset; có thêm 6 kiểm tra joystick và 4 kiểm tra độ phân giải render theo kích thước/DPR.
- Kiểm tra TypeScript và build production: **vượt qua**.
- `npm run test:scenarios`: **vượt qua**. 10 trận mô phỏng chỉ quan sát bot, dùng các seed cố định: tất cả kết thúc trong **418–432 giây**, còn **3–6 bot tại giây 60**. Người chơi thụ động thua sau 77–212 giây. Đây là kiểm tra mô phỏng, không phải các trận do người chơi tự hoàn thành.

## Kiểm thử tương tác trên trình duyệt

Đã kiểm tra bằng bàn phím và chuột trong bản dev:

- `E` nhặt đủ 8 loại súng; phím **1–8**, **Q** và **con lăn chuột** chọn/đổi đúng súng. Vị trí người chơi được đặt gần từng vật phẩm trong tình huống dev để kiểm tra thao tác nhặt.
- Giữ chuột trái: AR-26/VX-9/MG-60 bắn nhiều phát; SG-8/P-9/DMR-14/SR-98/AMR-50 chỉ bắn một phát và cần nhấp lại. Đạn HUD khớp đạn mô phỏng. `R` hoàn tất nạp AMR-50 về 4 viên.
- Giữ chuột phải mở scope DMR-14 **4×**, SR-98 **6×**, AMR-50 **8×**; FOV camera khớp độ phóng đại. Model người chơi được ẩn khi dùng scope. Thả chuột, đổi súng, pause, kết quả và menu đóng scope đúng.
- Đã kiểm tra 10 lần chiến thắng/chơi lại bằng tình huống dựng sẵn có đồ rơi: không còn vật phẩm của trận trước; thống kê hạ gục/phát bắn về 0. Sau khi tải trước cả hai mẫu súng ngắm của bot số 5, tài nguyên scene giữ nguyên qua cả 10 lần reset ở **1.593 mesh, 246 material và 107 transform node**. Model súng được cache khi dùng lần đầu.
- Kiểm tra riêng 16 model súng cho nhân vật/vật phẩm bằng Babylon NullEngine: tạo và hủy không để lại mesh hay material.

Các **tình huống do nhà phát triển dựng** dừng chuyển động bot và đặt mục tiêu cách người chơi **50 m**. Bắn bằng chuột qua scope đang hiển thị: SR-98 trúng đầu hạ mục tiêu 100 HP trong một phát; trúng thân còn 30 HP. AMR-50 bị nhà đặc chặn, không gây sát thương xuyên tường; trúng đầu bot cuối cho kết quả chiến thắng và đóng scope. Chơi lại xóa vũ khí đã nhặt và thống kê. Các tình huống này xác nhận camera/input/đường đạn/sát thương/kết quả, không đại diện cho một trận tự nhiên đầy đủ.

Bản production được kiểm tra trên **Chrome**:

- Chọn 7 bot hiển thị đúng 8 người còn sống khi bắt đầu; bản build không chứa đối tượng debug của dev.
- Nhặt **AMR-50 và SR-98 bằng di chuyển/bàn phím thật** quanh điểm xuất phát; chọn bằng phím 7/6. Scope 8×/6× hoạt động, bắn AMR-50 giảm đúng một viên.
- Ở **800 × 600** và **1440 × 900**, HUD và nhãn scope nằm trong màn hình, không có tràn ngang. Nhãn scope đã dời khỏi vùng thông tin súng/đạn và banner bo.
- Tạm dừng, tiếp tục và về menu hoạt động; scope không tồn tại trên menu.
- Ghi nhận **0 lỗi pageerror** trong các phiên kiểm thử mở rộng vũ khí.

Các thao tác W+Shift, Space, hồi máu, giữ nguyên thời gian khi pause, nạp súng trường/shotgun, lưu cài đặt và xử lý localStorage hỏng đã được kiểm tra trong bản trước; bộ kiểm thử logic hiện tại vẫn kiểm tra di chuyển/nhảy/hồi máu/pause.

## Điện thoại cầm ngang

Chrome giả lập cảm ứng iPhone, viewport **844 × 390** và **667 × 375**. Đã kiểm tra bằng sự kiện đa điểm cảm ứng của trình duyệt:

- Di chuyển/chạy bằng joystick, vuốt camera và giữ Bắn cùng lúc với 3 ngón; thả riêng ngón Bắn ngừng bắn, hủy cảm ứng ngừng di chuyển.
- Nhảy, nạp đạn, nhặt AMR-50, chọn qua Kho súng, bật/tắt scope 8×, đổi súng, hồi máu và tạm dừng/tiếp tục.
- Giữ nút Bắn với AMR-50 chỉ bắn một phát; cần chạm lại cho phát tiếp theo.
- Thay đổi viewport trong lúc bắn xóa trạng thái giữ nút, không làm nhân vật bắn liên tục ngoài ý muốn.
- Lần kiểm tra cảm ứng trước khi đổi độ phân giải: buffer là 733 × 339 và 580 × 326 pixel. Bản hiện tại đã bỏ giới hạn này: ở DPR 3, viewport 844 × 390 render **2532 × 1170 pixel** với cả hai mức chất lượng. Độ phân giải mới được xác nhận bằng kiểm thử logic; chưa đo lại buffer trong trình duyệt.
- Ghi nhận **0 lỗi pageerror**. Bot được giữ yên trong tình huống dev để kiểm tra input độc lập.

Chưa kiểm tra trên điện thoại vật lý, chưa cam kết FPS hoặc hỗ trợ riêng cho Safari iOS. Bố cục ưu tiên cầm ngang.

Ảnh minh chứng lưu cục bộ trong `output/playwright/`; thư mục này không được đưa lên Git:

- [Menu bản production](output/playwright/weapons-menu-production.png)
- [SR-98 ngắm mục tiêu 50 m, tình huống dev](output/playwright/scope-target-6x.png)
- [Scope bản production, 1440 × 900](output/playwright/scope-production-1440.png)
- [Scope bản production, 800 × 600](output/playwright/scope-production-800.png)

## Kích thước và giới hạn

Import Babylon theo từng module: gói JavaScript chính của bản hỗ trợ cảm ứng khoảng **1,05 MB**, tương đương **260 KB sau gzip**.

Toàn bộ thư mục `dist/` gồm **71 file**, tổng **1.777.763 byte** (khoảng **1,70 MiB**) trước nén truyền tải.

- Đồ họa dùng các hình khối low-poly tạo bằng mã. Nhà là vật cản có ngoại thất đặc, chưa có không gian vào bên trong.
- Chrome đã được kiểm tra. Edge được đề xuất sử dụng nhưng chưa được kiểm tra trong phiên này.
- Chưa có triển khai công khai; bản hiện tại chạy tại localhost.
- Chưa có phép đo hiệu năng đủ để cam kết FPS hoặc khả năng chạy trên mọi cấu hình máy.
