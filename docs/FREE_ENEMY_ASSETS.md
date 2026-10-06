# Asset quân địch miễn phí cho LASTLIGHT

Đã tải và tích hợp ngày **06/10/2026**: 12 ngoại hình từ bốn bộ nhân vật, dùng chung hệ thống súng, pose và giáp của game.

| Bộ | Ngoại hình áp dụng | Giấy phép / nguồn |
| --- | --- | --- |
| Ultimate Modular Men — Quaternius | SWAT có sẵn, Punk, Hoodie | CC0 1.0 — [SWAT](https://poly.pizza/m/Btfn3G5Xv4), [Punk](https://poly.pizza/m/BTALZymknF), [Hoodie](https://poly.pizza/m/gKLBoRsyKe) |
| Ultimate Modular Women — Quaternius | Nữ đặc nhiệm, nữ lính đánh thuê | [Punk](https://poly.pizza/m/djXoqejw6w): CC0 1.0. Bản GLB [Soldier](https://poly.pizza/m/oAArCNHjFB): CC BY 3.0, đã ghi tác giả, nguồn, giấy phép và chỉnh sửa trong menu |
| Toon Shooter Game Kit — Quaternius | Lính chiến, lính phòng hóa, quân đột kích | CC0 — [trang tác giả](https://quaternius.com/packs/toonshootergamekit.html) |
| Animated Characters Survivors — Kenney | Hai survivor và hai zombie | CC0 1.0 — [trang tác giả](https://kenney.nl/assets/animated-characters-survivors) |

Các tên gọi chỉ mô tả ngoại hình. Zombie vẫn dùng AI bắn súng của bot. Chọn nhân vật ổn định theo actor id; không thay chỉ số súng, AI hoặc hitbox. Target giả trong phòng tập giữ model riêng. Skin người chơi và đồng đội online tiếp tục theo lựa chọn hiện có.

## Tích hợp và hiệu năng

- `src/enemy-catalog.ts`: danh sách 12 ngoại hình và ngân sách model chi tiết.
- `src/enemy-assets.ts`: tải tám GLB mới khi vào trận, tối đa hai tác vụ tải/giải mã đồng thời; cache theo scene. SWAT tái sử dụng thư viện có sẵn. Kenney dùng một mesh, ba clip và bốn texture PNG gốc.
- `src/soldier.ts`: gắn súng bằng IK tay/chân, animation idle/run, tư thế ngồi/nằm và phụ kiện giáp. Model procedural dùng khi asset chưa tải, tải lỗi hoặc bot ở xa.
- `src/main.ts`: ưu tiên tối đa **16 bot gần nhất trong 65 m** trên desktop; **8 bot trong 35 m** khi dùng touch hoặc chất lượng thấp. Rig tạo khi cần, dọn cùng actor/scene.
- Thư viện mới dưới 6 MB gồm model và texture; không đưa toàn bộ môi trường/đạo cụ trong pack vào game.

Toon dùng `Index1` thay `Wrist` để xác định điểm bàn tay; súng gắn sẵn đã bỏ khỏi GLB để tránh chồng súng gameplay. Kenney chuyển FBX bằng bản phát hành chính thức FBX2glTF 0.9.7, sửa gốc skeleton về tổ tiên chung để tránh lặp biến đổi đơn vị/trục, ghép animation theo tên xương. Các model được căn chiều cao 1,78 m trước khi gắn vào tọa độ actor.

## Tải lại và ghi công

Chạy `npm run assets:fetch-enemies` trên Windows với Node và Python. Script tải converter chính thức vào `output/assets/enemies/tools/`; converter không cần cho build hoặc chạy game. Bản gốc và archive ở `output/assets/enemies/`, được Git bỏ qua. Model phục vụ game ở `public/assets/enemies/`.

`public/assets/enemies/manifest.json` lưu nguồn, tác giả, giấy phép, số byte và SHA-256. `processing.json` ghi bước xử lý; `CREDITS.md` và `Kenney-License.txt` giữ thông tin giấy phép. Menu ghi công có mục nhân vật và lưu yêu cầu CC BY 3.0 của bản Soldier nữ tải từ Poly Pizza, dù trang full pack của tác giả công bố CC0.

## Kiểm chứng

Unit test kiểm tra lựa chọn ổn định, giới hạn chi tiết, hash file, cấu trúc GLB, gốc skeleton, animation và súng Toon đã bỏ. Gallery trình duyệt tại `/tests/fixtures/enemy-gallery.html` kiểm tra cả 12 ngoại hình, texture Kenney, sai số tay cầm súng, chạy/ngồi/nằm, đổi mức chi tiết, giáp và dọn mesh. E2E kiểm tra bot thật trong phòng tập và trường hợp GLB trả 404 vẫn tiếp tục trận.

Ảnh kiểm tra lưu trong `output/playwright/enemies-*.png`. Giới hạn touch đã được áp dụng trong code; hiệu năng GPU trên điện thoại thật chưa đo.
