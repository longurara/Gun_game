# Asset miễn phí cho menu LASTLIGHT

Đã đối chiếu giao diện hiện tại và xác minh nguồn ngày **06/10/2026**. Đã tải và áp dụng **Bunker Panel UI Kit, Kenney Input Prompts và Kenney Interface Sounds**.

Khung chọn trận, thiết lập, phòng online, tài khoản và cửa sổ tạm dừng dùng khung Bunker tối/vàng; nút có trạng thái thường, hover, nhấn và vô hiệu hóa. Thanh hướng dẫn dùng SVG bàn phím/chuột và cử chỉ touch. Bốn âm thanh menu dùng chung âm lượng với game, chỉ phát sau thao tác người dùng. Mục **NGUỒN ASSET** trong menu ghi công Oğuzhan Girgin, liên kết CC BY 4.0 và mô tả chỉnh sửa. Giữ nhân vật SWAT 3D làm trung tâm.

Nguồn tải, giấy phép và checksum: [MENU_ASSETS.md](../src/assets/ui/MENU_ASSETS.md), [menu-manifest.json](../src/assets/ui/menu-manifest.json). Tải lại bằng `npm run assets:fetch-menu`.

Menu hiện tại có nhân vật SWAT 3D, nền tối và điểm nhấn vàng `#f5b50a`. Bunker dùng cho khung và nút, Kenney UI Pack giữ biểu tượng checkmark/star. Các ứng viên dưới đây gồm cả ba bộ đã tích hợp và các lựa chọn bổ sung chưa áp dụng.

## Lựa chọn chính

| Gói / nguồn | Nội dung đã xác minh | Dùng trong menu | Giấy phép |
| --- | --- | --- | --- |
| [Bunker Panel UI Kit](https://colorosse.com/assets/2d/ui/bunker-panel-ui-kit) | 18 sprite; panel, header, divider, chip, tooltip và trạng thái nút; SVG/PNG | Khung chọn bản đồ, danh sách phòng online, cửa sổ tài khoản, trạng thái nút | CC BY 4.0 — miễn phí, cần ghi công Oğuzhan Girgin |
| [Kenney UI Pack — Sci-Fi](https://kenney.nl/assets/ui-pack-sci-fi) | 130 asset; button, panel, slider | Lựa chọn khung điều khiển mang phong cách công nghệ | CC0 |
| [Kenney UI Pack](https://kenney.nl/assets/ui-pack) | 430 asset; button, panel, slider | Mở rộng bộ đang có cho thiết lập, dropdown, checkbox và tab | CC0 |
| [Kenney Input Prompts](https://kenney.nl/assets/input-prompts) | 1.500 glyph; bàn phím, chuột, touch và nhiều loại gamepad | Thanh hướng dẫn WASD, Space, Esc, Tab; hướng dẫn touch | CC0 |
| [Game-icons.net](https://game-icons.net/) | SVG/PNG, có nhóm weapon, symbol/emblem và GUI | Icon kho súng, trang bị, hồ sơ, thành tích và nút chức năng | CC BY 3.0 — cần ghi công tác giả từng icon |
| [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | 100 âm thanh interface/click/button | Hover, click, chọn bản đồ, xác nhận và thông báo | CC0 |
| [Kenney Pattern Pack](https://kenney.nl/assets/pattern-pack) | 80 pattern seamless, có vector; tile 256 × 256 | Họa tiết nền mờ trong panel hoặc sau nội dung menu | CC0 |
| [Barlow Condensed — Google Fonts](https://github.com/google/fonts/tree/main/ofl/barlowcondensed) | Font condensed, có subset Vietnamese | Tiêu đề, tên bản đồ, nút và số liệu; giữ font dễ đọc riêng cho mô tả dài | SIL OFL 1.1 — giữ copyright/license cùng file font |

Số lượng trong bảng là số công bố tại trang nguồn. Đã chọn 18 SVG phím/cử chỉ, 4 OGG và 10 SVG khung/nút Bunker; các gói khác trong bảng là ứng viên, chưa áp dụng.

## Bộ phối đề xuất

**Ưu tiên phong cách quân sự:** Bunker Panel làm khung/nút, Input Prompts làm hướng dẫn, Barlow Condensed cho tiêu đề và Interface Sounds cho tương tác. Dùng cùng palette tối/vàng của LASTLIGHT; khung cần đổi màu để đồng bộ. Giữ nhân vật SWAT và cảnh 3D đang có làm phần trung tâm menu.

**Lựa chọn CC0 cho phần hình/âm thanh:** mở rộng Kenney UI Pack hoặc dùng UI Sci-Fi, phối với Input Prompts, Game Icons của [Kenney](https://kenney.nl/assets/game-icons) và Interface Sounds. Kenney Game Icons có 105 asset, CC0; phù hợp icon thao tác chung. Các icon gear/weapon chuyên biệt có thể cần vẽ bổ sung.

Nền ảnh tĩnh tùy chọn: [Tactical FPS Lobby Background](https://www.summerengine.com/asset-store/tactical-fps-lobby-background-f70acd76). Trang người đăng ghi CC0 và ảnh được tạo bằng Grok Imagine. Chỉ là ứng viên; cần kiểm tra ảnh, kích thước, bố cục và tránh để nhân vật trong ảnh trùng với SWAT 3D của menu.

## Nguồn kiểm tra bổ sung

- [Preview chính chủ Bunker Panel](https://cdn.colorosse.com/img/bunker-panel-ui-kit/bunker-panel-ui-kit-1600.webp).
- [FAQ về cách ghi công icon](https://game-icons.net/faq.html).
- [Metadata Barlow Condensed xác nhận Vietnamese](https://raw.githubusercontent.com/google/fonts/refs/heads/main/ofl/barlowcondensed/METADATA.pb).
- [License font gốc](https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed/OFL.txt).

Khi dùng Bunker Panel, ghi tác giả Oğuzhan Girgin, tên bộ, liên kết trang nguồn, CC BY 4.0 và các thay đổi đã thực hiện trong mục Credits. Khi dùng Game-icons.net, giữ credit và giấy phép đúng cho từng icon đã chọn.
