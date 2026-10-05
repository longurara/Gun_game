# LASTLIGHT — game sinh tồn trên web

Game bắn súng sinh tồn một người, góc nhìn thứ ba, chạy trên trình duyệt. Bạn nhảy xuống một hòn đảo **4 × 4 km** cùng **100 bot**, lục nhà tìm súng và giáp, lái xe, tránh vòng bo và là người sống cuối cùng. Có bản đồ nhỏ 200 m (5 hoặc 7 bot) cho trận ngắn. Điều khiển bàn phím/chuột trên máy tính và cảm ứng trên điện thoại. Dự án dùng TypeScript, Vite và Babylon.js; không cần máy chủ.

## Chạy trên máy

Cần Node.js 22.12 trở lên và npm. Mở terminal trong thư mục dự án:

```sh
npm ci
npm run dev
```

Mở địa chỉ mà Vite hiển thị, thường là `http://127.0.0.1:5173`. Chọn bản đồ, số bot, độ khó rồi nhấn **BẮT ĐẦU TRẬN**. Nhấp vào khung game để điều khiển chuột. Âm thanh được bật sau thao tác của bạn trên trang.

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

## Hai bản đồ

| | Đảo LASTLIGHT | Đấu trường |
| --- | --- | --- |
| Kích thước | 4 × 4 km | 200 × 200 m |
| Số bot | 25 / 50 / **100** | 5 / 7 |
| Địa hình | Đồi núi, bờ biển và bãi cát, 7 hồ sâu, 3 con sông cạn lội được, ruộng, rừng, đường nối 16 thị trấn | Mặt phẳng, vài khối nhà đặc |
| Nhà | **Vào được**: có cửa, cửa sổ, mái dốc; ~390 ngôi nhà | Khối đặc, không vào được |
| Xe | ~47 chiếc dọc đường và trong thị trấn | Không có |
| Khởi đầu | Mọi người xuất hiện rải rác trên đất liền, chỉ có súng lục P-9 | Có sẵn súng và đồ quanh điểm xuất phát |
| Thời lượng | Khoảng 9–10 phút (vòng bo thu qua 7 giai đoạn) | Khoảng 7 phút |

Sông chỉ sâu khoảng nửa mét nên đi bộ và lái xe qua được; biển và hồ đủ sâu để chặn đường. Vòng bo luôn thu về đất liền, không về mặt nước. Bản đồ đảo được sinh từ một hạt giống cố định nên mọi trận đều chơi trên cùng một hòn đảo (vị trí xuất hiện và đồ thay đổi theo trận).

## Điều khiển máy tính

| Phím / thao tác | Chức năng |
| --- | --- |
| W A S D | Di chuyển theo hướng camera |
| Chuột | Xoay camera |
| Shift | Chạy nhanh |
| Space | Nhảy (khi lái xe: phanh tay) |
| Chuột trái | Giữ để bắn súng tự động; mỗi nhấp một phát với súng bán tự động / lên đạn từng phát |
| Giữ chuột phải | Ngắm qua vai; DMR-14 / SR-98 / AMR-50 mở ống ngắm 4× / 6× / 8× |
| R | Nạp đạn |
| E | Nhặt vật phẩm gần nhất (nếu không có gì để nhặt thì lên/xuống xe) |
| F | Lên / xuống xe |
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
| Nút Nhảy | Nhảy (khi lái xe: phanh tay) |
| Nút Nạp, Nhặt, Hồi máu | Các hành động tương ứng; khi có xe gần, nút Nhặt dùng để lên/xuống xe |
| Kho súng / Đổi súng | Chọn một trong các súng đang mang, hoặc đổi tuần tự |
| Chạm minimap | Mở bản đồ lớn |
| Nút Tạm dừng | Mở menu pause |

Có thể dùng hai ngón: ngón trái di chuyển, ngón phải giữ và kéo nút Bắn để vừa bắn vừa ngắm. Độ nhạy vuốt được điều chỉnh theo kích thước màn hình; chỉnh thêm trong Thiết lập. Khi mở bản đồ/kho súng, tạm dừng hoặc chuyển tab, thao tác đang giữ được giải phóng. Cảm ứng không cần khóa chuột.

HUD điện thoại dùng nút tròn trong suốt và nút bắn ở cả hai bên, bản đồ nhỏ phía trên phải, thanh máu và các ô súng có biểu tượng gọn dưới giữa. Chạm trực tiếp ô súng để chọn; nút mũi tên mở bảng chọn khi cần trên màn hình rộng. HUD PC dùng la bàn trên giữa, máu/đạn dưới giữa, các ô súng và minimap bên phải; vùng nhìn giữa màn hình được giữ thoáng.

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
