# Thư viện công trình miễn phí cho LASTLIGHT

Đã tải và kiểm tra ngày 06/10/2026: **10 gói Kenney, 860 model/mảnh ghép GLB**, khoảng **20,6 MiB** gồm texture, ảnh xem trước và giấy phép. Số GLB thực tế trong archive có thể khác số asset quảng bá trên website do model mẫu và biến thể.

Đây là thư viện nguồn để nâng cấp bản đồ. **Các công trình trong game chưa được thay bằng những model này.** Súng, SWAT và UI đã được tích hợp riêng trong `src/free-assets.ts` và `src/free-assets.css`.

## Gói đã tải

| Gói chính chủ | GLB thực tế | Dùng cho |
| --- | ---: | --- |
| [Building Kit](https://kenney.nl/assets/building-kit) | 79 | Tường có lỗ cửa/cửa sổ, sàn, mái, cầu thang, cột, cửa có animation |
| [Modular Buildings](https://kenney.nl/assets/modular-buildings) | 108 | Mặt tiền nhà nhiều tầng, nhà mẫu, tháp mẫu, mái và chi tiết ngoại thất |
| [City Kit — Suburban](https://kenney.nl/assets/city-kit-suburban) | 40 | Nhà dân, gara, hàng rào, lối xe vào |
| [City Kit — Commercial](https://kenney.nl/assets/city-kit-commercial) | 41 | Nhà phố, văn phòng, cao ốc, mái hiên |
| [City Kit — Industrial](https://kenney.nl/assets/city-kit-industrial) | 37 | Nhà máy, kho, ống khói, bồn chứa, container |
| [Factory Kit](https://kenney.nl/assets/factory-kit) | 143 | Máy móc, ống dẫn, cửa kho, cầu thang sắt và sàn thao tác |
| [City Kit — Roads](https://kenney.nl/assets/city-kit-roads) | 95 | Đường, giao lộ, dốc, trụ cầu, đèn, biển báo, rào chắn |
| [Furniture Kit](https://kenney.nl/assets/furniture-kit) | 140 | Giường, giường tầng, bàn, ghế, tủ, nội thất nhà và doanh trại |
| [Survival Kit](https://kenney.nl/assets/survival-kit) | 80 | Lều, nhà tạm, vách kim loại, hàng rào, thùng và đồ dã ngoại |
| [Space Station Kit](https://kenney.nl/assets/space-station-kit) | 97 | Hành lang, cửa, cầu thang, vách và thiết bị để tùy biến nội thất bunker |

Tất cả các gói trên là **CC0**, dùng được cho dự án cá nhân và thương mại, không bắt buộc ghi công. Mỗi thư mục giữ nguyên `License.txt` của tác giả. `manifest.json` lưu trang nguồn, URL archive, SHA-256 và danh sách file đã tải; ảnh xem trước nằm trong `Preview.png`.

## Đối chiếu với toàn bộ nhóm công trình hiện có

Các tên dưới đây là file có thật trong thư viện. Chúng là ứng viên cho việc dựng lại công trình; chưa bảo đảm là model thay trực tiếp vừa kích thước.

| Công trình trong mã bản đồ | Gói / model đề xuất | Phần cần ghép hoặc điều chỉnh |
| --- | --- | --- |
| Nhà dân — `world.ts` | Suburban: `building-type-a.glb` … `building-type-u.glb`; Building Kit: `wall-doorway-square.glb`, `wall-window-square.glb` | Nhà nguyên khối dùng ở xa; nhà đi vào được ghép theo vị trí cửa hiện tại |
| Chung cư — `buildTower(... apartment)` | Modular Buildings: `building-window.glb`, `building-door.glb`, `building-sample-tower-a.glb`; Building Kit: sàn/cầu thang | Ghép theo từng tầng và chừa lõi cầu thang |
| Bệnh viện — `buildTower(... hospital)` | Building Kit + Furniture: `bedSingle.glb`, `cabinetBed.glb`, `desk.glb` | Cần biển bệnh viện, giường y tế/thiết bị chuyên dụng; giường hiện có là giường dân dụng |
| Tháp canh — `buildTower(... tower)` | Building Kit: `column.glb`, `stairs-open.glb`, `border-high.glb`, mái/sàn; Factory: `catwalk-straight.glb` | Ghép tháp có cầu thang theo kích thước 6,4 × 14 m |
| Kho / hangar — `buildHangar` | Industrial: `building-a.glb` …; Factory: `door-wide-open.glb`, `catwalk-stairs.glb`; Building Kit | Giữ hai lối vào, gác lửng và ramp; nhà kho nguyên khối không mặc định có nội thất đi vào được |
| Doanh trại và trụ sở — `hot.ts` base | Building Kit + Modular Buildings; Furniture: `bedBunk.glb`; Survival: `tent.glb` | Ghép vỏ nhà, giường tầng, lều; chi tiết quân sự bổ sung từ nguồn dưới đây |
| Nhà xưởng và văn phòng — `hot.ts` factory | Industrial + Factory + Modular Buildings | Máy, đường ống và sàn thao tác chỉ bố trí ở chỗ không chắn lối chơi |
| Silo / ống khói — `hot.ts` | Industrial: `detail-tank-large.glb`, `chimney-large.glb`, `chimney-basic.glb` | Bồn chứa là ứng viên cho silo; cần chỉnh tỷ lệ/ghép để khớp silo 8 × 8 × 22 m |
| Container / sân vật tư | Industrial: `shipping-container-a.glb` … `shipping-container-c.glb`; Factory: `box-large.glb` | Khớp vị trí và kích thước vật cản hiện tại |
| Nhà che cửa bunker — `underground.ts`, `HotShed` | Building Kit + Survival: `structure-metal-doorway.glb`, `structure-metal-roof.glb` | Chừa hố và cầu thang xuống hầm |
| Bunker / phòng ngầm | Building Kit: sàn/tường/cột; Space Station: cửa và cầu thang | Hạ bớt chi tiết sci-fi, đổi vật liệu; lắp theo hình học hành lang, portal và trần hầm |
| Tường bao / cổng / hàng rào | Suburban: `fence-1x2.glb`; Survival: `fence-fortified.glb`, `fence-doorway.glb`; Roads: `construction-fence.glb` | Cổng phải khớp lối xe và lối người đi |
| Đường / cầu / bãi xe | Roads: `road-straight.glb`, `road-crossroad.glb`, `road-slant.glb`, `bridge-pillar.glb` | Ghép mặt đường và trụ theo địa hình; không có cầu hoàn chỉnh thay trực tiếp |
| Nội thất / vật chắn / đồ phụ | Furniture + Factory + Survival | Ghép cùng các điểm loot và vật cản đã có |

Nguồn cấu trúc đã đối chiếu: `src/game/world.ts`, `src/game/buildings.ts`, `src/game/hot.ts`, `src/game/underground.ts`, `src/island-renderer.ts`, `src/island-decor.ts`.

## Nguồn bổ sung cho công trình đặc thù

Các gói dưới đây **đã tìm và xác minh trang nguồn, chưa tải hoặc áp dụng**:

- [Quaternius Simple Buildings](https://quaternius.com/packs/simplebuildings.html): 10 model, gồm bệnh viện, nhà và cửa hàng; CC0; FBX/OBJ/Blend, cần xuất sang GLB và kiểm tra nội thất.
- [Military Outpost Kit](https://blendswap.com/blend/28377) của Britdawgmasterfunk: CC0, file Blender; có bunker, tháp canh, công sự, bao cát và vật tư quân sự; cần xuất/giảm polygon và đồng bộ vật liệu.
- [Military Base Pack](https://zsky2000.itch.io/military-base-pack) của Zsky: hơn 20 model, gồm lều y tế và tháp bắn tỉa; miễn phí theo **CC BY 4.0, bắt buộc ghi công Zsky**.
- [Low Poly Bunker Free](https://heyheythere.itch.io/low-poly-bunker-free): 16 props/mảnh ghép, cửa bunker và thiết bị có animation, GLB/FBX/OBJ; **CC BY 4.0, bắt buộc ghi công heyheythere**. Đây là bản mẫu miễn phí, bộ đầy đủ có phí.
- [Quaternius Downtown City MegaKit](https://quaternius.com/packs/downtowncitymegakit.html): nguồn nâng cấp mặt tiền đô thị chi tiết hơn. Chỉ khoảng 60–70% nội dung miễn phí; không coi toàn bộ 315 model và project Source là miễn phí.

Như vậy thư viện đã có vật liệu dựng hình cho mọi nhóm công trình hiện tại, nhưng các công trình đặc thù vẫn cần lắp ghép và một số chi tiết riêng. Chưa có một pack miễn phí duy nhất thay trực tiếp toàn bộ bản đồ, với nội thất/cửa/cầu thang khớp gameplay.

## Tải lại và tích hợp

Chạy `npm run assets:fetch-buildings` với Node.js và Python để tải lại GLB, texture và giấy phép từ Kenney. Archive ZIP gốc được lưu trong `output/assets/buildings/` (không commit). Thư viện nguồn ở đây nằm ngoài `public/`, nên không được đưa vào bản build của game.

Khi tích hợp: chọn vài mẫu cho mỗi nhóm, ghép theo các khoảng cửa/sàn/ramp trong dữ liệu collision, đổi vật liệu về cùng palette với SWAT, rồi dùng instance/merge theo chunk và model đơn giản ở xa. Chỉ copy các model được dùng vào `public/assets/`; kiểm tra đi qua cửa, lên cầu thang, bắn qua cửa sổ, loot và đường xuống bunker trước khi mở rộng sang cả bản đồ.
