# Âm thanh bắn súng miễn phí cho LASTLIGHT

Xác minh trang nguồn và quyền sử dụng ngày **06/10/2026**. **Đã tải hai pack SnakeF8 và mẫu LMG KuraiWolf, chọn và tích hợp 8 mẫu bắn một phát** vào `GameAudio`. Bảy mẫu Snake dùng bản Isolated; tất cả được cắt khoảng lặng, chuyển mono 44,1 kHz, chuẩn hóa peak 0,85, fade đuôi 25 ms và nén OGG. Dữ liệu nguồn, SHA-256 và độ dài từng mẫu nằm trong `src/assets/audio/guns/manifest.json`; ghi công có trong menu **NGUỒN ASSET** và `CREDITS.md` cùng thư mục.

Tải lại bằng `npm run assets:fetch-gun-audio` (Node, Python, FFmpeg chỉ cần cho việc tải/xử lý). Các archive đầy đủ ở `output/assets/gun-audio/` được bỏ qua bởi Git; bản game chỉ chứa khoảng 84 KB audio đã chọn. Các nguồn còn lại dưới đây chưa tải hoặc tích hợp. Số file và dung lượng của toàn pack là thông tin trang nguồn công bố.

Game tải/decode một lần khi vào trận hoặc phòng tập; bắn khi chưa tải xong/tải lỗi sử dụng âm procedural ngay, không phát trễ. Mẫu mới dùng chung volume/mute, giảm âm và lọc tần số theo khoảng cách, stereo pan và echo bunker. Các nguồn đang phát bị giới hạn 96; tạm dừng dừng âm, dispose hủy tải và dọn cache. Tiếng bolt/nạp đạn vẫn do hệ thống cũ xử lý.

## Nguồn ưu tiên

| Nguồn | Âm thanh bắn được công bố | Định dạng / dung lượng | Quyền sử dụng |
| --- | --- | --- | --- |
| [Snake's Authentic Gun Sounds — SnakeF8](https://f8studios.itch.io/snakes-authentic-gun-sounds) | .22LR, 5.56, 7.62×39, 7.62×54R; kèm reload, bolt, AK racking, shotgun pump. Tổng 54 âm khác nhau, hơn 140 file gồm biến thể | WAV/MP3; gunshot có bản giữ/bỏ tiếng vang tự nhiên; ZIP 11 MB | Tác giả xác nhận miễn phí, dùng thương mại, không bắt buộc ghi công tại trang pack. Giữ bằng chứng quyền sử dụng khi tải; không tự gán nhãn CC0 cho pack đầu nếu archive không xác nhận |
| [Snake's SECOND Authentic Gun Sounds Pack — SnakeF8](https://f8studios.itch.io/snakes-second-authentic-gun-sounds-pack) | 9mm, .308/7.62×51, 20 gauge; kèm thao tác pistol, revolver, nạp băng và bipod. Tổng 68 âm khác nhau, hơn 166 file gồm biến thể | WAV/MP3; bản giữ/bỏ tiếng vang; ZIP 12 MB | Dùng thương mại, không bắt buộc credit; tác giả xác nhận **public domain**, cho phép ghi là CC0 trong [trao đổi chính chủ](https://itch.io/post/9313369) |
| [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) | Thư viện firearm với nhóm rifle, shotgun, pistol, revolver, automatic, bolt-action theo trang phân phối | `Prepared SFX Library.7z`, 194 MB tại OGA | CC0. Tác giả thu: Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney. Website gốc không truy cập được khi kiểm tra; dùng bản lưu OGA, không dựa vào các link cũ |
| [Light Machine Gun — KuraiWolf](https://opengameart.org/content/light-machine-gun) | Một tiếng bắn LMG, ứng viên cho `lmg` | `lmg_fire01.mp3`, 44,1 kHz, 79,4 KB | **CC BY 4.0**, ghi công KuraiWolf; không phải CC0 |
| [Silenced pistol shot — Clutvh](https://freesound.org/people/Clutvh/sounds/627087/) | Mẫu thiết kế cho pistol 1911 có giảm thanh; chưa xác nhận là bản thu súng thật | MP3 stereo, 44,1 kHz, khoảng 3 giây / 44,9 KB | CC0; **Freesound yêu cầu đăng nhập để tải bản gốc** |

Các con số 54 và 68 bao gồm cả âm thao tác súng, không chỉ gunshot. Không coi tổng số file MP3/WAV/bản vang là số tiếng bắn độc lập.

## Nguồn dự phòng

- [Gunshot Sounds — Tabasco](https://opengameart.org/content/gunshot-sounds): **CC0**, `sounds.zip` 5,5 MB; tiếng bắn CZ-52, Mosin Nagant, SKS, shotgun do tác giả ghi khi tập bắn. Tác giả nói thiết bị thu không xử lý âm lượng tốt như mong muốn; cần nghe, kiểm tra nhiễu/clipping trước khi chọn.
- [Chaingun, pistol, rifle, shotgun shots — Michel Baradari](https://opengameart.org/content/chaingun-pistol-rifle-shotgun-shots): **CC BY 3.0**, `shots.7z` 638,5 KB; một shot cho mỗi loại, rifle/shotgun kèm reload. Cần cắt phần shot riêng để nhịp reload do gameplay điều khiển; ghi công Michel Baradari.

Nguồn bổ sung đã có từ lần trước: [Gun reload sounds — SpringySpringo](https://opengameart.org/content/gun-reload-sounds), CC0, ba WAV thao tác/nạp đạn; đây không phải nguồn tiếng nổ đầu nòng.

## Đối chiếu với game

Ánh xạ đã áp dụng theo họ súng/calibre, không phải bản thu riêng của mọi gun id. AMR/.50, cung và launcher giữ âm procedural.

| Nhóm âm thanh trong game | Ứng viên đầu tiên |
| --- | --- |
| `pistol` | 9mm của Snake pack 2 |
| `smg` | 9mm pack 2, phát từng shot theo nhịp của gun config |
| `rifle` | 5.56 hoặc 7.62×39 pack 1 |
| `dmr` | .308 pack 2 |
| `sniper` | 7.62×54R pack 1; tiếng bolt vẫn được tổng hợp |
| `heavySniper` | Chưa có bản thu .50 được xác minh trong shortlist; giữ âm hiện tại cho tới khi chọn mẫu phù hợp |
| `shotgun` | 20 gauge pack 2; đây không phải bản thu 12 gauge |
| `lmg` | Light Machine Gun của KuraiWolf |
| Có silencer | .22LR pack 1, giảm gain và lọc low-pass; không phải bản thu giảm thanh của từng rifle |

## Xử lý và ghi công

Hai pack Snake có tổng archive khoảng 24 MiB; game dùng bảy mẫu Isolated và một mẫu LMG KuraiWolf. Echo của bunker được điều khiển bởi `GameAudio`.

Unit test kiểm tra ánh xạ mọi gun id, preload/cache, lỗi tải/decode, khoảng cách/pan/echo, giảm thanh/mute, bắn liên thanh và dọn graph. Trình duyệt thật kiểm tra giải mã các mẫu local, bắn qua simulation, giảm thanh, restart dùng lại buffer và fallback khi trả 404. Mẫu OGG sau nén không có sample clipping khi đo bằng FFmpeg.

Mục **NGUỒN ASSET** đã bổ sung ba nguồn, ghi công KuraiWolf, link CC BY 4.0 và các chỉnh sửa. Bản giấy phép CC BY 4.0 và ReadMe gốc Snake pack 2 được giữ cùng asset. Chỉ dùng phần đã xác nhận miễn phí; các nguồn demo/bản trả phí chưa tích hợp.
