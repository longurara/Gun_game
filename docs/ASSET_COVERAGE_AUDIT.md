# Những phần còn thiếu model / texture / asset trong LASTLIGHT

Rà soát ngày **06/10/2026**, sau khi tích hợp máy bay ở commit `890a2d8`. Đối chiếu mã dựng hình, bộ tải model, file runtime trong `public/assets/`, texture và âm thanh trong `src/assets/`, cùng thư viện nguồn công trình.

Đây là kiểm kê từ mã nguồn và file trên đĩa; không phải đo chất lượng hình ảnh của từng vật thể trong một phiên chơi. “Chưa có model tải ngoài” nghĩa là game đang dựng hình bằng mã. Màu vật liệu và màu đỉnh vẫn là cách hiển thị hợp lệ, nhưng chưa có ảnh texture thể hiện chi tiết bề mặt.

## Các nhóm cần bổ sung rõ nhất

| Nhóm | Hiện trạng | Phần còn thiếu | Mã liên quan |
| --- | --- | --- | --- |
| **12 loại xe** | Toàn bộ dựng từ hộp, trụ và các chi tiết ghép; sơn, lốp, ghế, bạt và kim loại chủ yếu là màu vật liệu | Model xe và texture bề mặt; lốp, ghế, thân xe hư hỏng | [main.ts](../src/main.ts): `createCarModel`, `createBikeModel`, `vehicleKit` và các hàm dựng từng xe; [vehicles.ts](../src/game/vehicles.ts) |
| **Mũ / áo giáp / ba lô** | Mũ là phần cầu; áo giáp và ba lô là các hộp ghép, phân cấp bằng màu | Model có hình dáng riêng, texture vải, dây đeo, túi và giáp | [main.ts](../src/main.ts): `createLootNode`, `buildGearModel` |
| **Phụ kiện súng** | Ống ngắm, giảm thanh, giảm giật, tay cầm và băng đạn dựng bằng trụ/hộp màu | Model và vật liệu chi tiết cho đồ nhặt | [main.ts](../src/main.ts): `buildGearModel`; [gear.ts](../src/game/gear.ts) |
| **Đạn / thuốc / đồ ném** | Đạn là hộp màu; băng gạc, túi cứu thương, chai thuốc và lon nước là hình đơn giản; các đồ ném dùng cầu và nắp hộp, kể cả Molotov khi nằm dưới đất | Hộp đạn có nhãn, chai/lon có nhãn, túi cứu thương và model riêng cho từng loại lựu đạn/Molotov | [main.ts](../src/main.ts): `AMMO_COLOR`, `buildSupplyModel`, `createLootNode` |
| **Vũ khí cận chiến** | Chảo, dao rựa, xà beng và liềm dựng bằng trụ/hộp/vòng; màu kim loại/gỗ trơn | Model riêng và texture kim loại/gỗ | [main.ts](../src/main.ts): `buildMeleeModel` |
| **Dù / thùng tiếp tế** | Dù là bán cầu có sọc màu đỉnh và dây nét; thùng là hộp màu gỗ với đai đỏ | Texture vải, đường may, model dù/thùng và texture ván gỗ/đai | [main.ts](../src/main.ts): `createChute`, `renderAirdrops` |
| **Khói / lửa / nổ / lóe đầu nòng** | Khói là các cầu mờ; lửa là trụ nhọn phát sáng; nổ/lóe dùng cầu; khói đánh dấu tiếp tế là trụ mờ đỏ | Sprite/atlas có alpha và hiệu ứng hạt cho từng nhóm | [main.ts](../src/main.ts): `smokeClouds`, `fireBeds`, xử lý `flash`/`explosion`, `renderAirdrops`; [weapon-models.ts](../src/weapon-models.ts): `flashTemplate` |

Các xe cụ thể: ô tô, xe máy, buggy, jeep, bán tải, van, buýt mini, coupe, tay ga, quad, tuk-tuk và xe máy thùng (`car`, `bike`, `buggy`, `jeep`, `pickup`, `van`, `minibus`, `coupe`, `scooter`, `quad`, `tuktuk`, `sidecar`).

Đồ nhặt cần phủ asset gồm ba cấp mũ/áo giáp, ba cấp ba lô, chín phụ kiện, 11 nhóm đạn, thuốc/đồ ném và bốn vũ khí cận chiến. Súng nhặt dưới đất đã đi qua `createWeaponModel`, nên không thuộc nhóm đồ nhặt chỉ là hộp màu.

Lưu ý: hàm `material()` trong `main.ts` chỉ tự gắn texture cho đúng hai tên `wood` và `dry-grass`. Các tên `melee-wood`, `airdrop-wood`, `gear-metal` hoặc `car-*` không tự nhận texture tương ứng.

## Công trình và môi trường: đã có một phần, cần hoàn thiện

| Nhóm | Đã có | Còn thiếu / chưa áp dụng |
| --- | --- | --- |
| **Công trình trên đảo** | Texture tường, mái, gỗ, cây, đá; facade và hình công trình dựng theo dữ liệu bản đồ | Model công trình/nội thất từ thư viện nguồn chưa đưa vào runtime. Một số chi tiết dùng vật liệu `plain`, ví dụ cầu thang bê tông, chưa có texture bề mặt riêng |
| **Thư viện công trình đã tải** | **860 GLB trong 10 gói Kenney**, đã đếm lại file thực tế | Nằm trong `assets-source/free-buildings/`, ngoài `public/`, nên chưa xuất hiện trong bản build. Có sẵn ứng viên cho nhà, kho, nhà máy, container, đường, hàng rào, bàn/ghế/giường và bunker |
| **Đấu trường nhỏ** | Texture nền cỏ khô và gỗ | Đường, tường, mái, đá, cây thông/thân cây, hàng rào và đồi vẫn phần lớn là màu trơn; hình dựng đơn giản |
| **Phòng tập / bãi xe** | Texture gỗ và biển khoảng cách vẽ bằng canvas | Cỏ, đất, bê tông, nhựa đường, tường, mái và đá chưa được gắn bộ texture tương tự bản đồ đảo |
| **Bầu trời** | Sphere có gradient màu đỉnh, mặt trời phát sáng, mây có texture tạo bằng canvas | Chưa có skybox/HDRI hoặc ảnh mây tải ngoài; đây là nâng cấp tùy chọn |
| **Nước / cây cỏ trên đảo** | Nước có normal map tạo bằng mã; cây/cỏ có atlas lá, texture vỏ cây; địa hình có texture hòa trộn | Chưa có bộ ảnh PBR/foam cho nước và model cây tải ngoài; không phải nhóm hoàn toàn chưa có texture |

Nguồn kiểm tra: [island-renderer.ts](../src/island-renderer.ts), [island-decor.ts](../src/island-decor.ts), [main.ts](../src/main.ts): `buildWorld`, `buildRangeScene`, `configureWorld`. Danh sách pack và cách ghép theo gameplay nằm trong [thư viện công trình](../assets-source/free-buildings/README.md).

## Vũ khí và nhân vật

- **Nỏ và súng phóng**: `freeGun()` chưa ánh xạ lớp `bow` và `launcher` sang GLB. Ví dụ: Nỏ săn, Nỏ chiến thuật, M-79 và Panzerfaust. Chúng vẫn có hình dựng bằng mã và vật liệu bề mặt từ `surfaceMaterial`; cần model riêng, không phải thiếu toàn bộ texture.
- **Các súng còn lại**: đã có 13 GLB, nhưng nhiều tên/biến thể súng dùng chung model theo lớp và một vài từ khóa trong `look`. Nếu cần hình dáng đúng từng tên súng thì phải bổ sung model tương ứng; hiện chưa có asset riêng cho từng khẩu trong toàn bộ arsenal.
- **Texture súng/SWAT nhập ngoài**: bộ `litMaterials()` trong [free-assets.ts](../src/free-assets.ts) dùng màu tác giả và không chuyển ảnh albedo sang vật liệu mới. Có model nhưng không có bộ texture bề mặt chi tiết ở đường tải này; phù hợp phong cách low-poly hiện tại. Loader máy bay và nhân vật mới xử lý riêng.
- **Quân địch**: 12 diện mạo đã được tích hợp, có model nhập ngoài và một số texture ảnh. Nhân vật ở xa dùng hình dự phòng để giới hạn tải; việc đó không đồng nghĩa chưa tải asset.

Nguồn: [free-assets.ts](../src/free-assets.ts), [weapon-models.ts](../src/weapon-models.ts), [surface-materials.ts](../src/surface-materials.ts), [arsenal.ts](../src/game/arsenal.ts), [enemy-assets.ts](../src/enemy-assets.ts), [enemy-catalog.ts](../src/enemy-catalog.ts).

## Asset âm thanh còn thiếu bản thu

Đã có tám file tiếng súng và bốn file âm thanh giao diện. Các nhóm dưới đây vẫn chủ yếu được tổng hợp bằng oscillator/noise trong [audio.ts](../src/audio.ts), chưa có sample thu âm riêng trong thư viện audio hiện tại:

- Bước chân, gồm bước chân người khác; chưa có sample phân biệt cỏ/đất/bê tông/kim loại.
- Thay đạn, ném đồ, đánh cận chiến và va chạm xe.
- Động cơ xe, tiếng nổ, khói/lửa và flash.
- Mở/đóng cửa hầm, gió khi rơi, thở, hồi máu và âm nền hầm.

Nhạc menu cũng đang được tổng hợp bằng mã trong [menu-music.ts](../src/menu-music.ts).

## Những phần đã có asset, không cần tìm lại từ đầu

- Máy bay: `public/assets/aircraft/airplane.glb`, có texture nhúng và cơ chế dự phòng.
- Súng phổ thông, SWAT và các diện mạo quân địch: bộ model trong `public/assets/free/` và `public/assets/enemies/`.
- Menu: giao diện Bunker, bộ UI/input prompts Kenney và âm thanh giao diện đã được gắn.
- Texture địa hình và các bề mặt chính của đảo, cây/cỏ và facade đã được gắn.
- Icon HUD dạng SVG, tâm ngắm, vòng loot, tracer và đèn báo là hình/vector/hiệu ứng chức năng được tạo có chủ đích; không cần coi mọi vật liệu màu đơn là asset bị thiếu.

## Thứ tự nâng cấp đề xuất

1. Xe: nhóm dễ thấy và toàn bộ 12 loại hiện chưa có model tải ngoài.
2. Khói, lửa, nổ và lóe đầu nòng: thay hình khối bằng atlas/particle thích hợp.
3. Đồ nhặt, giáp, ba lô và thùng tiếp tế: cải thiện khả năng nhận diện từng món.
4. Gắn chọn lọc model từ 860 GLB công trình đã tải; bổ sung texture cho đấu trường/phòng tập và vật liệu `plain` cần chi tiết.
5. Model nỏ/súng phóng và model riêng theo tên súng; âm thanh bước chân/thay đạn/động cơ.
6. Skybox và chi tiết nước sau khi các nhóm chính đã được phủ asset.

Khi tích hợp công trình cần khớp cửa, sàn, cầu thang, đường xuống hầm và collision hiện tại. Đồ nhặt đang merge/instance theo loại, công trình stream theo chunk và quân địch giới hạn chi tiết theo khoảng cách; các nâng cấp nên giữ các cơ chế này.
