# Asset súng miễn phí bổ sung cho LASTLIGHT

Đối chiếu mã game và xác minh trang tác giả ngày **06/10/2026**. Các gói mới dưới đây mới được nghiên cứu, **chưa tải hoặc tích hợp trong đợt này**.

## Những chỗ còn thiếu trong game

- `public/assets/free/` đang có 13 model súng Quaternius. Nhiều mẫu trong `src/game/arsenal.ts` dùng chung model thông qua `freeGun()` trong `src/free-assets.ts`.
- LMG hiện dùng một model assault rifle; nên bổ sung model súng máy có hình dáng đúng hơn cho MG-60, DP-28 và M249.
- `bow` và `launcher` vẫn dùng hình dựng bằng code, chưa có GLB nhập ngoài. Rocket launcher là nhóm nên bổ sung trước.
- Bộ súng hiện tại được bake thành mesh để instance/merge. Rig của model mới hoặc animation nạp đạn sẽ cần đường dựng model riêng; tải model có rig không tự tạo animation nạp đạn trong game.

## Các nguồn đã xác minh

| Nguồn chính chủ | Nội dung | Giấy phép | Mức phù hợp |
| --- | --- | --- | --- |
| [Quaternius Ultimate Guns — bản gốc](https://quaternius.com/packs/ultimategun.html) | 40 model theo trang tác giả; FBX, OBJ, Blend | CC0 | Ưu tiên mở rộng cùng phong cách bộ đang dùng; file gốc cần xuất sang GLB |
| [Pichuliru Flat Guns East](https://pichuliru.itch.io/cc0-flat-guns-east) | 10 mẫu theo thiết kế Nga, có rig và bone phụ kiện; GLB/FBX/OBJ/Blend | CC0 theo mô tả tác giả | Ưu tiên cho súng hiện đại, đổi màu được; cần kiểm tra model cụ thể trước khi gán cho từng gun id |
| [Pichuliru Flat Guns West](https://pichuliru.itch.io/cc0-flat-guns-west) | 10 mẫu theo thiết kế Mỹ/châu Âu, có rig và bone phụ kiện; GLB/FBX/OBJ/Blend | **Mô tả ghi CC0 nhưng bảng metadata ghi CC BY 4.0** | Ứng viên tốt về hình dáng; cần kiểm tra license trong archive và giữ credit khi tích hợp |
| [Pichuliru Flat Gun Attachments](https://pichuliru.itch.io/cc0-flat-guns-attachments) | 18 phụ kiện; GLB/FBX/OBJ/Blend | CC0 theo mô tả tác giả | Ưu tiên cho phụ kiện có hình 3D; hợp bộ Flat Guns |
| [Quaternius Animated Guns](https://quaternius.com/packs/animatedguns.html) | 6 súng có animation, gồm P90, revolver, pistol, shotgun và sniper; FBX/OBJ/Blend | CC0 | Ưu tiên khi làm chuyển động từng bộ phận; cần xuất animation sang GLB |
| [Zsky Low Poly Weapons V.1](https://zsky2000.itch.io/low-poly-weapons-pack-v1) | Hơn 20 model súng; archive khoảng 7,5 MB | **CC BY 4.0, bắt buộc ghi công Zsky** | Nguồn bổ sung cho nhiều dáng pistol/SMG/rifle/sniper; kiểm tra định dạng trong ZIP trước khi áp dụng |
| [Low Poly Rocket Launcher — khairul169](https://opengameart.org/content/low-poly-rocket-launcher) | 1 model launcher: 624 vertices, 1.236 triangles; archive có scene Godot | CC0 | **Ưu tiên cho lớp launcher đang thiếu GLB**, nhẹ; cần kiểm tra archive và xuất sang GLB nếu cần |
| [Kenney Blaster Kit](https://kenney.nl/assets/blaster-kit) | 40 asset, có animation/biến thể, crates, silencer, throwables và smoke | CC0 | Phù hợp phong cách sci-fi; không mặc định thay được các súng hiện đại của game |
| [3dmodelscc0 Guns & Explosives](https://3dmodelscc0.itch.io/free-cc0-guns-explosives-pack) | 19 súng/đồ nổ, gồm AK-47, M4A1, Makarov, Luger, shotgun, sniper và grenade; archive RAR 154 MB | CC0 | Nguồn khác cho súng/đồ nổ có tên cụ thể; cần kiểm tra texture, dung lượng và chuyển định dạng trước khi dùng trên web |
| [3DAssets.dev Mega Weapon Pack](https://3dassets.dev/packs/mega-weapon-pack) | 173 GLB, gồm súng, launcher, phụ kiện và props; tổng khoảng 156,3 MB | CC0 | Phủ nhiều loại và có animation/socket, nhưng nhiều model có hàng chục nghìn triangles; cần giảm chi tiết cho game/mobile. Trang tác giả ghi cả 173 file được tạo với AI |

Số lượng trong bảng là số tác giả công bố; chưa phải số model đã kiểm tra trực tiếp từ archive. Không coi “rigged” là đã có clip animation hoàn chỉnh.

## Mở rộng nhanh từ thư viện đang dùng

[Ultimate Guns trên Poly Pizza](https://poly.pizza/bundle/Ultimate-Guns-Pack-cpgUfI4t2F) có **25 mục** trong danh sách đã đọc: 21 súng và 4 phụ kiện. Đây không phải toàn bộ 40 model của bản gốc trên trang Quaternius.

13 súng đã dùng để tạo các visual hiện tại. Có thể bổ sung **8 model súng và 4 phụ kiện còn lại**, cùng CC0 và cùng phong cách:

| Model chưa dùng | Model ID |
| --- | --- |
| Pistol | `J3i9KDQ3kt` |
| Pistol | `Z7aOjJu583` |
| Pistol | `52kQzphmeF` |
| Revolver | `XrnLUz6kQj` |
| Revolver | `E7IaG9TptR` |
| Shotgun Sawed Off | `29FXKu7G91` |
| Shotgun Short Stock | `MHv3uOV6ja` |
| Sniper Rifle | `TKaBjAEofL` |
| Bipod | `Ugy8tjR3Ju` |
| Bayonet | `D81P2smzCy` |
| Scope | `Y9DSevnvGq` |
| Tripod | `sVTKUSz3m2` |

Các ID trên được đối chiếu với dữ liệu pack dùng bởi script tải hiện tại. Dùng ID cố định để tránh phụ thuộc thứ tự model trên website.

## Thứ tự bổ sung đề xuất

1. Lấy 8 súng còn lại trong bộ Quaternius để tăng biến thể pistol/revolver/shotgun/sniper với ít thay đổi về phong cách.
2. Bổ sung launcher từ khairul169 và tìm model LMG khớp hình dáng trong các pack hiện đại; không gán một rifle thành M249 chỉ vì cùng class gameplay.
3. Thêm phụ kiện Quaternius hoặc Flat Gun Attachments, gắn theo muzzle/rail/grip của từng model.
4. Dành pipeline giữ rig/animation cho Animated Guns hoặc Flat Guns sau khi có model tĩnh ổn định.

Khi tích hợp, giữ nguyên thông số chiến đấu; kiểm tra hướng +Z, kích thước, vị trí hai tay, muzzle flash, loot, shadow, đổi súng và fallback. Chỉ đưa file thật sự dùng vào `public/assets/`; library/source lớn nằm ngoài bản build.
