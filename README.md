# LASTLIGHT — game sinh tồn trên web

Game bắn súng sinh tồn một người, góc nhìn thứ ba, chạy trên trình duyệt. Bạn nhảy xuống một hòn đảo **4 × 4 km** cùng **100 bot**, lục nhà tìm súng và giáp, lái xe, tránh vòng bo và là người sống cuối cùng. Có bản đồ nhỏ 200 m (5 hoặc 7 bot) cho trận ngắn. Điều khiển bàn phím/chuột trên máy tính và cảm ứng trên điện thoại. Dự án dùng TypeScript, Vite và Babylon.js; không cần máy chủ.

## Chạy trên máy

Cần Node.js 22.12 trở lên và npm. Mở terminal trong thư mục dự án:

```sh
npm ci
npm run dev
```

Mở địa chỉ mà Vite hiển thị, thường là `http://127.0.0.1:5173`. Chọn bản đồ, số bot, độ khó rồi nhấn **BẮT ĐẦU TRẬN**. Nhấp vào khung game để điều khiển chuột. Âm thanh được bật sau thao tác của bạn trên trang.

Để thử gyro trên điện thoại cần HTTPS: `npm run dev:https` (xem mục con quay hồi chuyển bên dưới).

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

Mở địa chỉ **Network** mà Vite in ra trên điện thoại, ví dụ `http://192.168.1.10:5173`. Dùng đúng địa chỉ IP/cổng của máy tính; `127.0.0.1` trên điện thoại trỏ tới chính điện thoại. Nếu cần tìm IPv4 trên Windows, dùng `ipconfig`. Nếu không truy cập được, kiểm tra Node/Vite được phép qua Windows Firewall trên mạng riêng.

Thiết bị cảm ứng mặc định **chất lượng thấp** khi chưa có cài đặt đã lưu; cài đặt bạn đã chọn trước đó được giữ lại. Bố cục điện thoại ưu tiên **cầm ngang**: joystick bên trái, nút bắn/ngắm bên phải.

## Chơi online với bạn bè

Ở màn hình chính chọn bản đồ, số bot, độ khó như thường rồi bấm **CHƠI VỚI BẠN BÈ · ONLINE**:

1. **Chủ phòng** nhập tên, bấm **TẠO PHÒNG MỚI** và nhận một **mã phòng 5 ký tự** (ví dụ `JTHHB`). Bấm **SAO CHÉP LINK** để gửi bạn bè một đường dẫn dạng `…/?room=JTHHB`; mở link đó là tự điền mã.
2. **Bạn bè** nhập tên và mã (hoặc mở link) rồi bấm **VÀO PHÒNG**. Tối đa **6 người**. Phòng đầy hoặc trận đã bắt đầu thì báo lỗi.
3. Chủ phòng bấm **BẮT ĐẦU TRẬN**. Mọi người cùng nhảy dù xuống một hòn đảo giống hệt nhau, cùng bot, cùng đồ trong nhà; **người sống cuối cùng thắng** (bạn bè là đối thủ của nhau). Bạn bè mặc áo màu khác bot và có **tên nổi trên đầu**. Ai bị hạ thì xem tiếp trận (Q/E đổi người xem) và có thể rời trận; khi kết thúc mọi người thấy ai thắng.

Cách hoạt động: dùng **Supabase Realtime (broadcast)**, không cần tài khoản hay cơ sở dữ liệu. **Máy chủ phòng chạy toàn bộ trận** (bot, vòng bo, xe, hộp tiếp tế) và gửi ảnh chụp trạng thái 10 lần mỗi giây; máy các bạn chạy một bản sao cùng hạt giống, tự dự đoán chuyển động của chính mình để điều khiển mượt, vẽ người khác chậm khoảng 0,15 giây và gửi lại thao tác (di chuyển, bắn, nạp đạn, nhặt đồ…) cho chủ phòng. Chủ phòng quyết định đạn có trúng hay không; mọi người cũng không thấy bot ở xa người nào (chỉ gửi những gì trong vòng 420 m quanh người chơi) nên băng thông nhỏ (khoảng 3–9 KB mỗi gói).

Giới hạn cần biết:
- **Chủ phòng nên để tab game ở phía trước** và có mạng ổn định: trình duyệt làm chậm tab nền, khi đó cả phòng bị chậm theo. Chủ phòng thoát hoặc mất mạng thì trận kết thúc cho mọi người; bạn bè thoát hoặc im quá 8 giây thì bị loại khỏi trận.
- Gói miễn phí của Supabase giới hạn **100 tin nhắn mỗi giây cho cả dự án** (mỗi phòng dùng khoảng 10 + 10 mỗi người). Vài phòng nhỏ cùng lúc thì đủ; nhiều hơn thì cần nâng gói.
- Ai biết mã phòng đều vào được (không có mật khẩu). Chưa có chat, bảng điểm, ngồi chung xe, hay gia nhập giữa trận. Lái xe online có độ trễ bằng đường truyền vì xe do chủ phòng điều khiển.
- Không chống gian lận: chủ phòng là "máy chủ" nên chỉ nên chơi với người quen.
- Địa chỉ và khóa công khai (publishable) của dự án Supabase nằm trong [src/net/config.ts](src/net/config.ts); đổi sang dự án khác bằng `VITE_SUPABASE_URL` và `VITE_SUPABASE_KEY` trong `.env.local` (xem `.env.example`). **Không bao giờ đưa khóa service-role vào trình duyệt hay vào mã nguồn.**

Mã: [src/net/protocol.ts](src/net/protocol.ts) (ảnh chụp trạng thái), [src/net/session.ts](src/net/session.ts) (chủ phòng và máy khách), [src/net/lobby.ts](src/net/lobby.ts) (phòng chờ), [src/net/transport.ts](src/net/transport.ts) (Supabase và mạng giả lập cho test), [src/lobby-ui.ts](src/lobby-ui.ts).

## Hai bản đồ

| | Đảo LASTLIGHT | Đấu trường |
| --- | --- | --- |
| Kích thước | 4 × 4 km | 200 × 200 m |
| Số bot | 25 / 50 / **100** | 5 / 7 |
| Địa hình | Đồi núi, bờ biển và bãi cát, 7 hồ sâu, 3 con sông cạn lội được, ruộng, rừng, đường nối 16 thị trấn | Mặt phẳng, vài khối nhà đặc |
| Nhà | **Vào được**: có cửa, cửa sổ, mái dốc; ~390 ngôi nhà | Khối đặc, không vào được |
| Xe | ~47 chiếc dọc đường và trong thị trấn | Không có |
| Khởi đầu | **Nhảy dù từ máy bay** (xem mục Nhảy dù), chỉ có súng lục P-9 | Có sẵn súng và đồ quanh điểm xuất phát |
| Thời lượng | Khoảng 9–10 phút (vòng bo thu qua 7 giai đoạn) | Khoảng 7 phút |

Sông chỉ sâu khoảng nửa mét nên đi bộ và lái xe qua được; biển và hồ đủ sâu để chặn đường. Vòng bo luôn thu về đất liền, không về mặt nước. Bản đồ đảo được sinh từ một hạt giống cố định nên mọi trận đều chơi trên cùng một hòn đảo (vị trí xuất hiện và đồ thay đổi theo trận).

## Điều khiển máy tính

| Phím / thao tác | Chức năng |
| --- | --- |
| W A S D | Di chuyển theo hướng camera |
| Chuột | Xoay camera |
| Shift | Chạy nhanh |
| Space | Nhảy (khi lái xe: phanh tay). Trên máy bay: nhảy dù; khi rơi tự do: mở dù |
| Chuột trái | Giữ để bắn súng tự động; mỗi nhấp một phát với súng bán tự động / lên đạn từng phát |
| Giữ chuột phải | Ngắm qua vai; DMR-14 / SR-98 / AMR-50 mở ống ngắm 4× / 6× / 8× |
| C / Z | Ngồi / nằm (bấm lại để đứng lên). Nhảy hoặc chạy cũng đứng lên |
| R | Nạp đạn |
| E | Nhặt vật phẩm gần nhất (nếu không có gì để nhặt thì lên/xuống xe) |
| F | Lên / xuống xe. Trên không: giống Space (nhảy / mở dù) |
| 1 · 2 · 3 | Chọn súng ở ô 1 và 2 (súng thường), ô 3 (súng lục) |
| Q / cuộn chuột | Đổi tuần tự giữa các súng đang mang |
| H | Dùng túi cứu thương; đứng yên để hoàn tất |
| M | Mở / đóng bản đồ lớn (có tên thị trấn); nhấp vào minimap cũng mở được |
| Esc | Tạm dừng / tiếp tục |

Di chuyển, nhảy hoặc bắn sẽ hủy hồi máu. Khi chuyển sang cửa sổ/tab khác hoặc mất khóa chuột, trận tự tạm dừng. Tạm dừng đóng băng bot, vòng bo và các bộ đếm gameplay.

## Điều khiển cảm ứng

| Thao tác | Chức năng |
| --- | --- |
| Kéo cần bên trái | Di chuyển theo hướng camera; kéo gần hết hành trình để chạy nhanh. Khi lái xe: lên/xuống là ga/lùi, trái/phải là lái |
| Vuốt vùng trống bên phải | Xoay camera |
| Nút Bắn | Giữ và kéo để vừa bắn vừa xoay camera; chạm lại cho mỗi phát với súng bán tự động / súng ngắm |
| Nút Ngắm | Bật / tắt ngắm qua vai hoặc ống ngắm |
| Nút Nhảy | Nhảy (khi lái xe: phanh tay). Trên máy bay: nhảy dù; khi rơi tự do: mở dù (nút sáng viền vàng) |
| Nút Ngồi, Nằm | Cạnh nút bắn bên trái; chạm lại để đứng lên |
| Nút Nạp, Nhặt, Hồi máu | Các hành động tương ứng; khi có xe gần, nút Nhặt dùng để lên/xuống xe |
| Kho súng / Đổi súng | Chọn một trong các súng đang mang, hoặc đổi tuần tự |
| Chạm minimap | Mở bản đồ lớn |
| Nút Tạm dừng | Mở menu pause |

Có thể dùng hai ngón: ngón trái di chuyển, ngón phải giữ và kéo nút Bắn để vừa bắn vừa ngắm. Độ nhạy vuốt được điều chỉnh theo kích thước màn hình; chỉnh thêm trong Thiết lập. Khi mở bản đồ/kho súng, tạm dừng hoặc chuyển tab, thao tác đang giữ được giải phóng. Cảm ứng không cần khóa chuột.

### Con quay hồi chuyển (ngắm bằng cách xoay điện thoại)

Vào **Thiết lập** trước trận (chỉ hiện trên điện thoại): chọn **Tắt**, **Khi ngắm** (mặc định: chỉ hoạt động khi đang ngắm hoặc đang giữ nút Bắn, nên đi bộ không bị giật) hoặc **Luôn bật**. Xoay điện thoại để chỉnh tâm; vuốt màn hình vẫn dùng song song. Độ nhạy 1× nghĩa là camera quay đúng bằng góc bạn xoay máy; khi ngắm qua ống ngắm độ nhạy tự giảm theo độ phóng đại. Có thêm tùy chọn đảo chiều lên/xuống.

Điều kiện: trình duyệt chỉ cho trang đọc cảm biến khi trang chạy qua **HTTPS hoặc localhost**, nên mở game bằng `http://192.168.x.x:5173` sẽ báo "Cần mở game bằng HTTPS". Chạy `npm run dev:https` trên máy tính (chứng chỉ tự ký) rồi mở địa chỉ **Network** `https://192.168.x.x:5173` trên điện thoại, chấp nhận cảnh báo chứng chỉ một lần. Nút con quay trong trận (cạnh nút tạm dừng) bật/tắt nhanh gyro. Trên iPhone, Safari hỏi quyền cảm biến khi bạn chạm **BẮT ĐẦU TRẬN** hoặc đổi chế độ. Mã nằm ở [src/gyro.ts](src/gyro.ts) (chuyển tốc độ quay thành góc camera theo trục trọng lực, có test trong tests/gyro.test.ts).

HUD điện thoại dùng nút tròn trong suốt và nút bắn ở cả hai bên, bản đồ nhỏ phía trên phải, thanh máu và các ô súng có biểu tượng gọn dưới giữa. Chạm trực tiếp ô súng để chọn; nút mũi tên mở bảng chọn khi cần trên màn hình rộng. HUD PC dùng la bàn trên giữa, máu/đạn dưới giữa, các ô súng và minimap bên phải; vùng nhìn giữa màn hình được giữ thoáng.

## Ngắm bắn: giật, tán đạn, tư thế

Mô hình ngắm lấy PUBG PC làm chuẩn cho cảm giác (đạn bay tức thì nhưng **rơi theo đường cong** trên đảo và đấu trường, xem bên dưới):

- **Đạn rơi.** Mỗi lớp súng có vận tốc đầu nòng (súng lục 360 m/s, tiểu liên và shotgun 400, súng trường 740–800, súng thiện xạ 830, súng ngắm 920, AMR 960) và **điểm 0**: khoảng cách mà đường đạn cắt đường ngắm (súng có ống ngắm 100 m, súng trường 60–70 m, súng lục 40 m). Gần hơn điểm 0 đạn cao hơn tâm vài cm, xa hơn thì thấp hơn: súng ngắm SR-98 ở tầm tối đa 210 m trúng thấp khoảng nửa mét, nên ngắm cao hơn đầu một chút nếu muốn bắn đầu từ xa. Điểm 0 hiện ở nhãn ống ngắm (ví dụ "6× · 100 M"). Dưới 45 m đạn bay thẳng. Bot tự tính bù. Sân tập 200 m vẫn bắn thẳng. Trọng lực được phóng đại để hiệu ứng có ý nghĩa ở tầm bắn của game; chưa có thời gian bay của đạn (không cần ngắm đón đầu).

- **Giật theo mẫu từng súng.** Phát đầu của loạt bắn không bị lệch (đạn đi trước khi tâm giật); các phát sau tâm **leo lên mạnh dần** (tối đa khoảng 16° sau 14 phát súng trường) và **lắc ngang theo một mẫu riêng của mỗi súng**, thiên dần về một bên. Hạ chuột xuống để bù: phần bạn đã kéo xuống không bị tâm trả lại. Ngừng bắn thì tâm **tự trở về** chỗ cũ (trừ phần bạn đã bù) trong chưa đến một giây; trong lúc xả liên tục gần như không tự hồi nên giật dồn lại. Ngắm qua ống giảm 30%, ngồi giảm 20%, nằm giảm 40%; vừa chạy vừa bắn giật thêm. Thiết lập có thanh **Độ giật súng** (1× là đầy đủ; điện thoại mặc định 0,75×).
- **Tán đạn khi di chuyển.** Đi bộ, chạy nước rút và nhảy làm đạn tán rộng hơn (nhảy tệ nhất), ngắm qua ống giảm bớt. **Tâm ngắm giãn ra theo độ tán** hiện tại, nên nhìn là biết lúc nào bắn chuẩn.
- **Ngồi và nằm** (C, Z hoặc nút). Ngồi: chậm 2,9 m/s, nằm: 1,3 m/s (đứng 5,2 m/s, chạy 8,1 m/s). Thấp hơn thì **tán đạn nhỏ hơn** (×0,72 / ×0,5), **giật ít hơn**, **thân nhỏ hơn** (bạn nằm thì đạn bắn ngang tầm ngực bay qua lưng), **khó bị bot phát hiện** (tầm phát hiện ×0,78 / ×0,55) và núp được sau vật cản thấp. Ngồi hoặc nằm chui được dưới vật cao dưới 1,4 m / 0,6 m, nhưng không đứng lên được nếu trên đầu không đủ chỗ. Lên xe, nhảy dù thì tự đứng. Bot đứng bắn thì ngồi.
- **Hỗ trợ ngắm (điện thoại).** Nhẹ hoặc Mạnh (như Free Fire): camera **chậm lại** khi tâm lướt qua một địch nhìn thấy được (còn khoảng 0,7× hoặc 0,5× ngay trên mục tiêu), và khi đang giữ nút bắn hoặc ngắm, tâm được **hút nhẹ về thân địch** rồi mờ dần ở mép vùng hỗ trợ (3,5° / 6°). Không hỗ trợ xuyên tường. Mặc định Nhẹ trên điện thoại, Tắt trên máy tính.

Mã: [src/game/recoil.ts](src/game/recoil.ts), [src/game/stance.ts](src/game/stance.ts), [src/aim-assist.ts](src/aim-assist.ts).

## Nhảy dù

Mỗi trận trên **đảo** và **đấu trường** bắt đầu trong một **máy bay vận tải** bay thẳng qua bản đồ (hướng và đường bay ngẫu nhiên theo từng trận, luôn cắt ngang bản đồ). Đường bay và biểu tượng máy bay hiện trên minimap / bản đồ lớn (phím M) cùng một **vòng tròn tầm lượn**: đáp trong vòng này là tới được. Sân tập 200 m không có máy bay.

| Giai đoạn | Điều khiển | Số liệu |
| --- | --- | --- |
| Trên máy bay | Xoay camera nhìn quanh; **Space / F / nút Nhảy** để nhảy (cửa mở sau 1,5 giây). Không nhảy thì bị đẩy ra khi máy bay hết đảo | Cao 800 m trên đảo (300 m ở đấu trường), bay ~74 m/s |
| Rơi tự do | W A S D lái theo hướng camera; **Shift** lao nhanh; Space / F mở dù (không mở được trong 1 giây đầu) | Lượn: 28 m/s ngang, rơi 45 m/s. Lao: 45 m/s ngang, rơi 78 m/s |
| Dù | W A S D lái; Shift bay nhanh hơn. Dù **tự mở ở độ cao 100 m** | Thường: 16 m/s ngang, rơi 6,5 m/s. Nhanh: 22 m/s ngang, rơi 9 m/s |

**Cờ đáp:** mở bản đồ lớn (phím M) và nhấp/chạm vào bản đồ để cắm cờ (nhấp lại vào cờ để bỏ). Cờ hiện trên minimap, thành một cột sáng vàng trong thế giới, và dòng trên màn hình báo khoảng cách cùng "tới được"/"ngoài tầm lượn". Sau khi nhảy, phím **G** (hoặc nút cờ trên điện thoại) bật **tự lái dù** bay thẳng tới cờ và giảm tốc khi gần; Shift vẫn để lao nhanh.

Lượn thường đi xa hơn, lao xuống thì tới đất sớm hơn để giành súng trước. Dù luôn mở trước khi chạm đất nên hạ cánh không mất máu. Rơi xuống nước thì tự bơi vào bờ gần nhất; dù không hạ xuống xuyên mái nhà mà vào sân bên cạnh. Khi còn ở trên không bạn và bot không bắn, không bị bắn và không chịu vòng bo; vòng bo đầu tiên được hoãn thêm thời gian bay.

Bot cũng nhảy: mỗi bot chọn điểm đáp trong tầm lượn của đường bay (khoảng 1/3 là thị trấn, còn lại là các điểm rải rác trên đất liền, ưu tiên chỗ chưa bot nào chọn), rồi nhảy đúng lúc để lượn tới đó; một số bot lao nhanh, một số mở dù cao. Logic nằm ở [src/game/drop.ts](src/game/drop.ts) (thông số, đường bay, vận tốc) và phần "The drop" trong [src/game/simulation.ts](src/game/simulation.ts).

## Hộp tiếp tế

Khi vòng bo bước sang giai đoạn 2 và 4 trên đảo (giai đoạn 2 và 3 ở đấu trường), một **hộp tiếp tế** thả dù xuống một điểm trong vòng bo kế tiếp; có thông báo, tiếng báo hiệu và biểu tượng hộp nhấp nháy trên bản đồ. Hộp rơi khoảng một phút, rồi tỏa **khói đỏ**. Bên trong: hai súng cấp 2 trở lên, mũ và áo cấp 3, hai túi cứu thương và đạn tương ứng. Khoảng 4/10 bot trong bán kính 800 m sẽ chạy tới lấy, nên đó cũng là nơi giao tranh. Chỉ có trong trận bắt đầu bằng nhảy dù.

## Khi bạn bị hạ

Màn kết quả có nút **XEM TIẾP TRẬN**: bạn tiếp tục theo dõi trận bằng camera quanh một bot (đầu tiên là người hạ bạn). **Q / E hoặc cuộn chuột** (nút Đổi súng trên điện thoại) đổi người xem; nút THOÁT về màn kết quả. Hạng và thời gian sống được giữ theo lúc bạn bị hạ, trận kết thúc khi còn tối đa một đối thủ.

## Âm thanh có hướng và gợi ý

- Tiếng súng của người khác và bước chân bot trong vòng 30 m được đặt trái/phải theo hướng camera (stereo; dùng tai nghe sẽ rõ). Tiếng của chính bạn ở giữa.
- **Gợi ý cho người mới** hiện một lần cho mỗi tình huống (nhặt đồ, xe, giáp, hồi máu, hộp tiếp tế) và được nhớ trong trình duyệt; tắt trong Thiết lập.
- **Hiện FPS** (Thiết lập) hiện FPS, thời gian khung trung bình và tệ nhất, số vật thể đang vẽ và số người trên không, để đo trên máy thật.

## Trang bị: tối đa 3 súng và một bộ giáp

Bạn mang **tối đa 3 khẩu**: hai súng thường (ô 1 và 2) và một súng lục (ô 3). Bảng vũ khí **chỉ hiện những gì đang mang**, không có ô trống ghi sẵn. Nhặt thêm một khẩu khi ô đã đầy sẽ đổi với khẩu đang cầm (hoặc khẩu yếu nhất nếu bạn đang cầm súng khác loại), khẩu cũ rơi xuống đất và băng đạn trong súng được hoàn về kho đạn. Mỗi loại súng dùng một loại đạn riêng.

| Súng | Loại | Cách bắn | Ống ngắm |
| --- | --- | --- | --- |
| AR-26 | Súng trường | Tự động | Ngắm qua vai |
| SG-8 | Shotgun | Bán tự động | Ngắm qua vai |
| VX-9 | Tiểu liên | Tự động | Ngắm qua vai |
| P-9 | Súng lục (ô 3) | Bán tự động | Ngắm qua vai |
| DMR-14 | Súng thiện xạ | Bán tự động | 4× |
| SR-98 | Súng ngắm | Lên đạn từng phát | 6× |
| AMR-50 | Súng ngắm hạng nặng | Lên đạn từng phát | 8× |
| MG-60 | Súng máy | Tự động | Ngắm qua vai |

**Giáp** gồm **mũ** (đỡ đòn bắn vào đầu) và **áo** (đỡ đòn vào thân), mỗi loại có cấp 1–3. Giáp chỉ được thay bằng cấp cao hơn, đồ cũ rơi xuống đất.

| Cấp | Giảm sát thương | Độ bền |
| --- | --- | --- |
| 1 | 30% | 80 |
| 2 | 40% | 150 |
| 3 | 55% | 230 |

Giáp hao mòn theo lượng sát thương nó đỡ và vỡ khi hết độ bền. Mũ không giúp khi bị bắn vào thân và ngược lại. Thanh trạng thái hiện chip giáp (cấp và độ bền) chỉ khi bạn đang mặc.

Thông số và thứ tự súng nằm ở [src/game/weapons.ts](src/game/weapons.ts); hằng số giáp cũng ở đó.

## Vật phẩm trong nhà

Trên đảo, khoảng **3/4 vật phẩm nằm trong nhà** (súng ngắm SR-98 và AMR-50 chỉ có trong nhà; DMR-14 và MG-60 gần như chỉ có trong nhà). Nhà ở thành phố và thị trấn lớn chứa đồ tốt hơn: giáp cấp cao và súng hạng nặng tập trung ở đó. Vào nhà qua cửa; cửa sổ cho phép nhìn và bắn qua ở độ cao ngực. Bot chết để lại mọi súng và giáp chúng mang.

## Xe

Khoảng 47 xe đỗ dọc đường và trong thị trấn. Lại gần và nhấn **F** để lên xe (chỉ chỗ lái, không có ghế phụ).

- Lái: ga, lùi, lái trái/phải, phanh tay; tốc độ tối đa khoảng 108 km/h; leo dốc chậm đi, xuống dốc nhanh lên.
- Không lái xe xuống biển hoặc hồ; sông cạn thì qua được.
- Đâm vào vật cản làm hỏng xe và gây thương cho người lái; xe hỏng nặng sẽ nổ, hất người lái ra, gây sát thương xung quanh và để lại xác xe chặn đường.
- Xe đang chạy đâm người gây sát thương theo tốc độ.
- Bắn vào xe sẽ phá xe; người lái chỉ chịu một phần nhỏ đạn trúng xe. Khi lái bạn không thể bắn, nạp đạn, nhặt đồ hay hồi máu.
- Bot đi xa sẽ tự đi bộ tới một chiếc xe gần đó, lái đến nơi, rồi xuống.

## Bot

100 bot chạy ba mức chi tiết theo khoảng cách tới bạn: bot gần (khoảng 220 m) chạy AI đầy đủ mỗi bước, bot tầm trung chạy vài lần mỗi giây, bot ở xa chạy một thói quen nhẹ. Giao tranh giữa các bot ở xa được giải quyết bằng xác suất (theo súng, máu, giáp, cự ly), nên người chơi sống sót lâu sẽ gặp bot đã trang bị tốt hơn.

Bot gần bạn: nhặt đồ trong nhà và quanh đó (chọn thứ có giá trị cao nhất theo khoảng cách, bỏ qua thứ không tới được), nghe tiếng súng và đi điều tra, né ngang khi giao tranh, ngắm có độ trễ nên chạy ngang sẽ khó trúng hơn, bắn theo loạt, đổi súng theo cự ly, tìm chỗ khuất để băng bó khi yếu, lên xe khi đích đến xa, và vào vòng bo.

## Cỏ và cây

Atlas ImageGen có bốn ô alpha riêng cho cây thông xa, cành thông, cành lá rộng và bụi cỏ; texture vỏ cây dùng UV chạy dọc thân. Cây gần dựng tán từ nhiều cành nhỏ, dùng chung một material và gộp mesh theo chunk. Cỏ nhận bóng trên PC, lay động bằng shader GPU và thu chiều cao ở rìa vùng hiển thị; không cập nhật ma trận mỗi khung hình.

Cỏ phân bố cố định theo địa hình, tránh đường, sông, hồ và dốc đá. Giới hạn 6.000 bụi trên PC, 2.600 trên thiết bị cảm ứng; bán kính thấy cỏ tương ứng khoảng 32 m và 22 m. Điện thoại vẫn render đủ DPR, không bật bóng. Texture và prompt nằm ở `src/assets/textures/`; đây là albedo, chưa phải bộ vật liệu PBR đầy đủ.

## Dữ liệu trên trình duyệt

`localStorage` lưu cài đặt và kỷ lục: tổng số trận thắng, số hạ gục cao nhất trong một trận, thời gian sống lâu nhất. Dữ liệu thuộc trình duyệt và địa chỉ website đang dùng; đổi trình duyệt, đổi địa chỉ hoặc xóa dữ liệu site sẽ không giữ cùng kỷ lục. Nếu trình duyệt chặn lưu trữ, game vẫn chạy nhưng dữ liệu có thể không được lưu.

Trận đang chơi không được lưu. **Tải lại trang sẽ về menu; bắt đầu lại một trận mới.** Bản hiện tại chưa có chế độ offline/PWA.

## Kiểm thử

```sh
npm test
npm run test:scenarios
```

Bộ kiểm thử tự động gồm **322 bài** ở `tests/`: catalogue hơn 100 súng, nhặt/đổi súng theo ô, giáp, bắn/trúng đầu/vật cản, nạp đạn, hồi máu, nhảy/va chạm, pause, bo, thắng/thua, reset, bot (nhặt đồ, đường đi, tầm nhìn), lưới không gian so với duyệt thủ công, sinh bản đồ đảo (đất liền, nước, nhà, loot), xe (lái, va chạm, đâm người, bị bắn, nổ, bot lái), và hai trận 100 bot trọn vẹn. Có thêm kiểm tra độ phân giải đầy đủ trên điện thoại ở DPR 1–4. Script kịch bản in kết quả trận trên bản đồ nhỏ.

Số đo trên máy phát triển (xem [KIEM_THU.md](KIEM_THU.md)): một trận 100 bot trên đảo kết thúc sau khoảng 580 giây game; mô phỏng tốn trung bình dưới 1 ms mỗi bước. Đây là kiểm tra logic và đo trên một laptop, **chưa phải đo FPS hay xác nhận hiệu năng trên điện thoại thật**.

## Đưa lên hosting tĩnh

Chạy `npm run build`, sau đó đưa **nội dung thư mục `dist/`** lên hosting tĩnh tại gốc website. Nếu dịch vụ có cấu hình build, dùng lệnh `npm run build` và thư mục đầu ra `dist`. Phục vụ qua HTTP(S), không mở trực tiếp `dist/index.html` bằng đường dẫn file. Nếu đặt game trong thư mục con của website, cần cấu hình `base` của Vite trước khi build.

Game một người không cần máy chủ trận đấu hay tài khoản. `npm run preview` chỉ dùng để xem thử bản build trên máy. Các hướng dẫn này chưa thực hiện xuất bản website.
