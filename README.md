# LASTLIGHT — game sinh tồn trên web

MVP single player 3D góc nhìn thứ ba, có điều khiển bàn phím/chuột trên máy tính và cảm ứng trên điện thoại/máy tính bảng. Bạn đối đầu với 5 hoặc 7 bot trên bản đồ low-poly 200 × 200 m, nhặt 8 loại súng, tránh vòng bo và sống sót cuối cùng. Có ống ngắm 4×, 6× và 8× với camera phóng đại. Dự án dùng TypeScript, Vite và Babylon.js.

## Chạy trên máy

Cần Node.js 22.12 trở lên và npm. Mở terminal trong thư mục dự án:

```sh
npm ci
npm run dev
```

Mở địa chỉ mà Vite hiển thị, thường là `http://127.0.0.1:5173`. Chọn độ khó, số bot rồi nhấn **BẮT ĐẦU TRẬN**. Nhấp vào khung game để điều khiển chuột. Âm thanh được bật sau thao tác của bạn trên trang.

Để tạo và xem bản build:

```sh
npm run build
npm run preview
```

`build` kiểm tra TypeScript và tạo thư mục `dist/`; `preview` phục vụ bản build tại địa chỉ terminal hiển thị. Dùng trình duyệt hỗ trợ WebGL; nếu game chạy chậm, chọn chất lượng đồ họa thấp trong **THIẾT LẬP**.

## Mở trên điện thoại qua Wi-Fi

Máy tính và điện thoại cùng mạng Wi-Fi/LAN. Chạy trên máy tính:

```sh
npm run dev -- --host 0.0.0.0
```

Mở địa chỉ **Network** mà Vite in ra trên điện thoại, ví dụ `http://192.168.1.10:5173`. Dùng đúng địa chỉ IP/cổng của máy tính; `127.0.0.1` trên điện thoại trỏ tới chính điện thoại. Nếu cần tìm IPv4 trên Windows, dùng `ipconfig`. Nếu không truy cập được, kiểm tra Node/Vite được phép qua Windows Firewall trên mạng riêng; mạng Wi-Fi khách có thể chặn thiết bị kết nối với nhau.

Để thử bản production qua LAN, chạy `npm run build` rồi `npm run preview -- --host 0.0.0.0` và mở địa chỉ Network mới. Cách này phục vụ game từ máy tính, chưa xuất bản lên internet.

Thiết bị cảm ứng mặc định **5 bot, đồ họa thấp** khi chưa có cài đặt đã lưu. Cài đặt bạn đã chọn trước đó được giữ lại. Bố cục điện thoại ưu tiên **cầm ngang**, với joystick bên trái và nút bắn/ngắm bên phải.

## Điều khiển máy tính

| Phím / thao tác | Chức năng |
| --- | --- |
| W A S D | Di chuyển theo hướng camera |
| Chuột | Xoay camera |
| Shift | Chạy nhanh |
| Space | Nhảy |
| Chuột trái | Giữ để bắn súng tự động; mỗi nhấp bắn một phát với súng bán tự động / lên đạn từng phát |
| Giữ chuột phải | Ngắm qua vai; DMR-14 / SR-98 / AMR-50 mở ống ngắm 4× / 6× / 8× |
| R | Nạp đạn |
| E | Nhặt vật phẩm gần nhất |
| 1–8 | Chọn súng đã nhặt theo bảng dưới |
| Q / cuộn chuột | Đổi tuần tự giữa các súng đã nhặt |
| H | Dùng túi cứu thương; đứng yên để hoàn tất |
| Esc | Tạm dừng / tiếp tục |

Di chuyển, nhảy hoặc bắn sẽ hủy hồi máu. Khi chuyển sang cửa sổ/tab khác hoặc mất khóa chuột, trận tự tạm dừng. Tạm dừng đóng băng bot, vòng bo và các bộ đếm gameplay.

## Điều khiển cảm ứng

| Thao tác | Chức năng |
| --- | --- |
| Kéo cần bên trái | Di chuyển theo hướng camera; kéo gần hết hành trình để chạy nhanh |
| Vuốt vùng trống bên phải | Xoay camera |
| Nút Bắn | Giữ với súng tự động; chạm lại cho mỗi phát với súng bán tự động / súng ngắm |
| Nút Ngắm | Bật / tắt ngắm qua vai hoặc ống ngắm |
| Nút Nhảy, Nạp, Nhặt, Hồi máu | Các hành động tương ứng; đứng yên để hồi máu |
| Nút Đổi súng / Kho súng | Đổi tuần tự hoặc chọn súng đã nhặt |
| Nút Tạm dừng | Mở menu pause; nhấn Tiếp tục để trở lại |

Có thể dùng nhiều ngón để vừa di chuyển, xoay camera và bắn. Khi tạm dừng, đổi súng hoặc chuyển tab, trạng thái ngắm/bắn được giải phóng. Cảm ứng không cần khóa chuột.

Nút Toàn màn hình xuất hiện khi trình duyệt có API phù hợp; đây là tùy chọn, không bắt buộc để chơi.

## 8 loại súng

| Phím | Súng | Loại | Cách bắn | Ống ngắm |
| --- | --- | --- | --- | --- |
| 1 | AR-26 | Súng trường | Tự động | Ngắm qua vai |
| 2 | SG-8 | Shotgun | Bán tự động | Ngắm qua vai |
| 3 | VX-9 | Tiểu liên | Tự động | Ngắm qua vai |
| 4 | P-9 | Súng lục | Bán tự động | Ngắm qua vai |
| 5 | DMR-14 | Súng thiện xạ | Bán tự động | 4× |
| 6 | SR-98 | Súng ngắm | Lên đạn từng phát | 6× |
| 7 | AMR-50 | Súng ngắm hạng nặng | Lên đạn từng phát | 8× |
| 8 | MG-60 | Súng máy | Tự động | Ngắm qua vai |

Người chơi bắt đầu với AR-26. Cụm vật phẩm ngay quanh điểm xuất phát có đủ 8 loại súng để thử; di chuyển đến gần và nhấn **E** hoặc nút **Nhặt** để lấy. Mỗi súng dùng một loại đạn riêng, có băng đạn và đạn dự trữ độc lập. Có thêm súng, đạn và thuốc rải trên bản đồ.

Ống ngắm chuyển camera tới tầm mắt, phóng đại cảnh theo súng, hiện lens tròn và reticle; thả chuột phải, chạm lại nút Ngắm hoặc đổi súng sẽ trở về góc nhìn thứ ba. Không có cơ chế thay phụ kiện hay chỉnh độ phóng đại. Thứ tự phím, tên và thông số súng lấy từ catalogue trung tâm [src/game/weapons.ts](src/game/weapons.ts).

## Nội dung đã có

- 8 loại súng có model riêng, nhịp bắn, sát thương, tầm bắn, độ tản, độ giật camera, băng đạn và thời gian nạp riêng. Bắn khi ngắm có độ tản riêng; đạn bị vật cản chặn, có sát thương thân/đầu và hitbox theo độ cao khi nhảy.
- Nhặt súng, đạn, thuốc; vật phẩm gần điểm xuất phát và đồ rơi từ bot. Nhà là vật cản đặc, không có nội thất để đi vào.
- Bot tuần tra quanh khu vực xuất phát, phát hiện địch theo hướng nhìn/đường nhìn, phản ứng và bắn có sai số, nạp đạn, hồi máu, giao chiến với nhau, đi vòng vật cản và ưu tiên vào bo.
- Vòng bo thu qua 6 giai đoạn, gây sát thương ngoài vùng an toàn và cuối cùng thu về 0. Mục tiêu thời lượng trận đầy đủ khoảng 6–10 phút; người chơi có thể thua sớm.
- Menu tiếng Việt, HUD máu/đạn, rack 8 ô súng, tâm ngắm/ống ngắm, báo trúng đạn, minimap địa hình/vị trí người chơi/bo, thông báo nhặt đồ, kết quả thắng/thua, số hạ gục, thời gian sống và độ chính xác; chơi lại hoặc về menu.
- Nhân vật low-poly, camera tránh vật cản, hiệu ứng đường đạn/chớp nòng và âm thanh tạo bằng Web Audio. Có tùy chọn đồ họa, âm lượng và độ nhạy chuột.
- Trên thiết bị cảm ứng, render có giới hạn số pixel, tắt bóng động, giảm cây/cỏ trang trí và tần suất cập nhật đồ họa/HUD. Khi trang bị ẩn, game tạm dừng và ngừng render. Các tối ưu này giữ nguyên luật trận và hitbox.

Thắng khi bạn còn sống và tất cả bot đã bị loại; thua khi bạn chết. Đây là bản MVP để chơi thử và tiếp tục tinh chỉnh cảm giác súng, hình ảnh và AI. Hiệu năng tùy thiết bị và trình duyệt.

## Dữ liệu lưu trên trình duyệt

`localStorage` lưu cài đặt và kỷ lục: tổng số trận thắng, số hạ gục cao nhất trong một trận, thời gian sống lâu nhất. Dữ liệu thuộc trình duyệt và địa chỉ website đang dùng; đổi trình duyệt, đổi địa chỉ hoặc xóa dữ liệu site sẽ không giữ cùng kỷ lục. Nếu trình duyệt chặn lưu trữ, game vẫn chạy nhưng dữ liệu có thể không được lưu.

Trận đang chơi không được lưu. **Tải lại trang sẽ về menu; bắt đầu lại một trận mới.** Bản hiện tại chưa có chế độ offline/PWA; cần truy cập website để tải trang và tài nguyên.

## Kiểm thử

```sh
npm test
npm run test:scenarios
```

Bộ kiểm thử tự động kiểm tra catalogue 8 súng, nhặt đúng súng/đạn, băng đạn và dự trữ độc lập, ngắm và độ tản, bắn/trúng đầu/vật cản, nạp đạn, hồi máu, nhảy/va chạm, pause, bo, thắng/thua, reset, đường đi của bot và 10 seed trận đầy đủ. Có thêm kiểm tra ngân sách pixel trên điện thoại/máy tính bảng ở DPR 1/2/3 và hành vi chất lượng desktop. Script kịch bản in kết quả cho người chơi thụ động và các trận chỉ quan sát bot.

Trong 10 seed đã kiểm tra sau khi mở rộng vũ khí, các trận chỉ quan sát bot kết thúc sau **418–432 giây** và còn **3–6 bot ở giây 60**. Đây là kiểm tra logic mô phỏng, không phải phép đo FPS hoặc bảo đảm thời lượng cho mọi cách chơi.

Phạm vi kiểm tra trình duyệt và ảnh minh chứng được ghi riêng tại [KIEM_THU.md](KIEM_THU.md). Chưa có phép đo FPS hay xác nhận hiệu năng trên điện thoại thật; các kiểm tra ngân sách render là kiểm tra logic. Các thiết bị và trình duyệt khác cần chơi thử riêng.

## Đưa lên hosting tĩnh

Chạy `npm run build`, sau đó đưa **nội dung thư mục `dist/`** lên hosting tĩnh tại gốc website. Nếu dịch vụ có cấu hình build, dùng lệnh `npm run build` và thư mục đầu ra `dist`. Phục vụ qua HTTP(S), không mở trực tiếp `dist/index.html` bằng đường dẫn file. Nếu đặt game trong thư mục con của website, cần cấu hình `base` của Vite trước khi build.

Game single player không cần máy chủ trận đấu hay tài khoản. `npm run preview` chỉ dùng để xem thử bản build trên máy. Các hướng dẫn này chưa thực hiện xuất bản website.
