# Rà soát và sửa lỗi multiplayer — 2026-10-08

Phạm vi: phiên bản gồm tối ưu mạng theo vùng quan sát. Tập trung vào reconnect, kết thúc trận, trường bắn, đồng bộ đồ và thống kê; chưa phải kiểm tra toàn bộ đồ họa/gameplay.

## Các lỗi đã sửa

### Hồi sinh khi offline làm mất bảo vệ 30 giây

Nếu mất kết nối khi đang chết tại trường bắn, cờ bảo vệ trước đây bị xóa vì nhân vật chưa sống. Khi hồi sinh sau hai giây, nhân vật vẫn offline nhưng có thể chịu sát thương.

`GameSimulation.setReconnecting` hiện giữ cờ theo trạng thái kết nối, kể cả khi nhân vật chết. Hồi sinh giữ bảo vệ đến lúc resume; hết hạn hoặc chủ động rời phòng vẫn xóa cờ và loại nhân vật. Kiểm thử bao gồm máu, giáp, reconnect sau hồi sinh và không hồi sinh lại sau khi hết 30 giây.

### Reconnect giả khi đã kết thúc trận

Host dừng gửi snapshot sau sáu lần gửi kết quả. Client trước đây vẫn coi ba giây im lặng là rớt mạng: ca tái hiện gọi reconnect ở 3350 ms dù đường truyền bình thường.

Sau khi nhận kết quả, client không dùng khoảng cách giữa snapshot để suy ra mất mạng. Vẫn gửi heartbeat input để host giữ kết nối/chat và vẫn xử lý lỗi/đóng transport thực tế. Kiểm thử giữ màn hình kết quả 36 giây, sau đó thử mất kết nối và đóng phòng thật.

### Nhặt một phần chồng đồ không cập nhật số lượng còn lại

Host còn ba băng gạc nhưng khách vẫn thấy bốn, kể cả sau 150 snapshot. Snapshot chỉ biết loot mới và loot bị lấy hết; các hàng sinh từ seed không được xác nhận lại nội dung thay đổi.

Builder hiện theo dõi số lượng/đạn đã nạp/độ bền của mỗi hàng. Gửi ngay hàng thay đổi cho từng khách và xác nhận lại hàng seed từng đổi mỗi 50 snapshot. Không gửi lại toàn bộ loot sinh sẵn. Kiểm thử bao gồm chồng đồ ban đầu, đồ thả động, mất bản cập nhật đầu, lấy hết chồng đồ và full resync.

### Thống kê trúng/hạ bia bị cộng hai lần trên khách

Kiểm thử bằng ba trình duyệt thật ghi nhận một lần trúng và một lần hạ bia bị cập nhật thành hai. Client nhận thống kê trường bắn từ snapshot riêng, rồi cộng thêm lúc xử lý sự kiện shot/kill.

Với trường bắn, phần xử lý sự kiện hiện dùng thống kê có thẩm quyền từ host. Hiệu ứng bắn, âm thanh, thông báo và kill feed vẫn xử lý bình thường. Kiểm thử trình duyệt theo dõi từng lần ghi bộ đếm, nên bắt được cả lỗi tăng tạm thời trước snapshot kế tiếp.

## Vòng rà soát tiếp theo

### Reconnect báo đã nối lại nhưng vẫn giữ vị trí/góc nhìn cũ

Gói resume khôi phục vị trí đối tượng khác nhưng bỏ qua vị trí của chính client; reconcile cũng bị bỏ qua ở gói này. Ca tái hiện giữ nhân vật tại `(20, 10, 30)` dù host đã gửi `(-60, 0, -22)`, cho đến lúc có snapshot thường tiếp theo.

Client hiện áp dụng ngay vị trí và yaw của bản thân khi nhận resume, trước khi cho người chơi điều khiển. Kiểm thử kiểm tra ngay sau gói resume, không dựa vào snapshot tiếp theo, và bao gồm cả lái xe.

### Đà nhảy/vượt vật cản cũ tiếp tục chạy sau reconnect

Vận tốc nhảy trên bộ không được khôi phục khi resume. Nhân vật đã tiếp đất trên host vẫn bật lên lại trên client; ca tái hiện tăng độ cao 0,203 m ở frame đầu dù không nhấn nhảy. Một animation vượt vật cản đang dang dở cũng có thể kéo người chơi trở lại vị trí cũ.

Resume hiện khôi phục vận tốc và tốc độ, hủy vault bị ngắt và xóa trạng thái giữ nút nhảy cũ. Snapshot thường vẫn giữ dự đoán nhảy để tránh giật khi có ping.

### Tổng hạ gục trong trận thường không được sửa sau reconnect

Snapshot mang tổng số kill của nhân vật, nhưng HUD trận thường chỉ cộng từ sự kiện kill. Nếu sự kiện đã mất lúc ngắt kết nối, resume có thể mang số đúng `5` trong khi HUD vẫn giữ `1`.

Tổng hạ gục trên HUD hiện lấy từ hàng human có thẩm quyền trong mọi loại trận. Phần hiệu ứng không cộng thêm từ kill echo nữa, nên cũng không đếm hai lần. Kiểm thử gồm resume không có sự kiện, snapshot lặp lại và một kill thật sau reconnect qua native WebRTC.

### Không xem được đồng đội còn ở trên máy bay/đang nhảy dù

Danh sách spectate trước đây loại mọi actor có trạng thái bay, bao gồm người chơi. Nếu tất cả đồng đội sống còn đang ở trên không, người bị hạ không có ai để xem.

Người chơi còn sống hiện được chọn ở mọi trạng thái bay; bot vẫn cần view hiện tại và ở gần người sống. Kiểm thử bao gồm máy bay, rơi tự do, dù và giao diện spectate đồng đội đang có dù qua WebRTC.

### Spectate có thể chọn bia đang ẩn

Bia bật lên/ẩn xuống có thể còn sống khi đang ẩn. Danh sách cũ không kiểm tra cờ `hidden`, nên camera có thể chuyển đến một bia không hiển thị.

Danh sách hiện bỏ qua bot/bia ẩn và giữ các kiểm tra visibility/khoảng cách. Kiểm thử dùng bia thực của trường bắn và xác nhận nó được chọn lại sau khi hiện lên.

## Kiểm thử hồi quy

- `tests/reconnect.test.ts`: bảo vệ khi hồi sinh offline, resume/expiry, kết quả trận và lỗi transport thật.
- `tests/net-interest.test.ts`: nội dung loot thay đổi, các khách độc lập, xác nhận lại khi mất cập nhật và codec.
- `tests/e2e/range-multiplayer.e2e.ts`: thống kê qua giao diện/game thực với native WebRTC.
- `tests/e2e/chat-reconnect.e2e.ts`: chat, reconnect và khách khác tiếp tục chơi.
- `tests/net-resume-state.test.ts`: vị trí/yaw, vận tốc, vault bị ngắt, xe và tổng kill có thẩm quyền.
- `tests/net-spectate.test.ts`: người chơi đang bay, bia ẩn và view bot hợp lệ.
- `tests/e2e/squad-drop.e2e.ts`: điều khiển nhảy dù theo đội, tách đội và spectate người dẫn đang bay.

Kết quả xác minh sau vòng tiếp theo: 819/819 kiểm thử unit qua; ba bài kiểm thử multiplayer trên trình duyệt (chat/reconnect, trường bắn và nhảy dù theo đội/spectate) đều qua; build thành công. Bài nhảy dù đã cập nhật allowlist để chấp nhận `rtc-reconnect`, vốn là signaling hợp lệ, đồng thời kiểm tra gameplay và reconnect ticket không đi qua signaling. `npm run net:measure` ở vòng sửa trước giải mã đúng mọi gói trong sáu cấu hình và giữ các mức dung lượng đã đo trước đó. Các kiểm thử trình duyệt dùng handshake giả lập và DataChannel WebRTC thật trên máy phát triển, không xác minh đường TURN giữa hai mạng bên ngoài.

## Vòng rà soát sau tối ưu bãi súng — 2026-10-08

### Hồi sinh bị kéo về chỗ vượt vật cản cũ hoặc tự bật lên

Hồi sinh thông thường chỉ đồng bộ actor và sửa vị trí, không bỏ vault/velocity trong runtime dự đoán của client. Khung hình tiếp theo có thể tiếp tục vault cũ, kéo người chơi từ điểm hồi sinh về điểm chết, hoặc dùng vận tốc nhảy cũ để bật lên lần nữa.

Client hiện nhận diện chuyển từ chết sang sống ở trường bắn, đặt ngay vị trí có thẩm quyền, bỏ lịch sử dự đoán và correction đang chờ, khôi phục chuyển động và làm mới runtime. Kiểm thử dùng một vault thật và vận tốc nhảy còn sót sau khi chết; bài WebRTC trình duyệt kiểm tra người hồi sinh đứng ở mặt đất, không có vận tốc nhảy cũ.

### Cooldown trước khi chết chặn súng sau hồi sinh

Runtime host được làm mới khi hồi sinh, còn runtime client giữ cooldown phát bắn trước khi chết. Timer bị đóng băng trong thời gian chết nên client có thể không cho bắn dù host đã cho phép.

Việc làm mới runtime dự đoán khi hồi sinh cũng xóa cooldown cũ. Kiểm thử bắn súng ngắm hạng nặng, chết ngay sau đó và xác nhận có thể bắn sau hồi sinh. Snapshot thường trong lúc còn sống vẫn giữ dự đoán nhảy và nhịp bắn hiện có.

### Đi cầu thang bị nội suy xuyên tường hoặc kéo ngược lại

Teleport gần hơn các ngưỡng sửa vị trí/nội suy chung bị coi như đi bộ. Đối với người chơi local, correction và vault cũ có thể kéo ngược người chơi; đối với người khác, các pose trước khi đi cầu thang có thể vẽ nhân vật trượt qua tường.

Sự kiện `portal` hiện đánh dấu ngắt nội suy ở mọi khoảng cách. Client dùng vị trí mới nhất trong snapshot, xóa pose cũ của actor đó và hủy chuyển động dự đoán bị ngắt. Kiểm thử dùng cầu thang thật trong simulation cho cả người local và người remote, với khoảng dịch chuyển chỉ 5 m.

### Rocket và đạn phóng nổ bị vẽ sai độ rơi

Client dùng gia tốc 16 m/s² cho mọi projectile, trong khi host dùng 0,96 m/s² cho rocket và 4,8 m/s² cho shell. Client cũng giữ vận tốc đứng ở giá trị snapshot nên hướng của đạn có thể không khớp quỹ đạo được vẽ.

Host và client hiện dùng chung hàm gia tốc theo loại projectile; client cập nhật cả vị trí và vận tốc theo khoảng thời gian dự đoán. Kiểm thử đối chiếu rocket, shell và lựu đạn thường. Phép chiếu vẫn có giới hạn 250 ms và va chạm/nảy/nổ do host quyết định.

### Lựu đạn dưới hầm hoặc trên tầng bị kéo về mặt đất

Phép chiếu client chặn projectile bằng độ cao terrain thay vì sàn đang đỡ nó. Lựu đạn dưới hầm có thể bật lên mặt đất bên trên; trên tầng cao có thể rơi xuyên sàn trong hình ảnh giữa hai snapshot.

Client hiện dùng `supportHeight` chung với simulation, xét sàn/hầm và độ cao ban đầu để không bỏ qua sàn khi bước dự đoán đi xuống. Kiểm thử gồm sàn hầm ở -10 m và sàn tầng ở 3 m.

### Kết quả xác minh

10 tình huống trong `tests/net-transitions.test.ts` đều thất bại trước bản sửa và đều qua sau bản sửa. Toàn bộ 831/831 kiểm thử unit qua; hai bài trình duyệt WebRTC (chat/reconnect và trường bắn ba người, có desktop/mobile) qua; TypeScript và production build qua. Không đổi cấu trúc gói tin hoặc phiên bản wire. Bản sửa này chưa được commit/push.

## Vòng rà soát thao tác và xe — 2026-10-08

### Bắn, đổi súng và nạp đạn bị đảo thứ tự trong cùng gói input

Client gom phát bắn và lệnh thành hai mảng riêng; host chạy mọi lệnh trước mọi phát bắn. Bắn rồi đổi súng có thể mất phát bắn do cooldown của súng mới, còn bắn rồi nạp đạn bị từ chối vì host thấy băng đạn vẫn đầy. Equip → bắn → equip cũng có thể dùng nhầm súng.

Gói có cả hai loại thao tác hiện gửi thêm `order` để host chạy theo thứ tự người chơi thực hiện. Host giới hạn số thao tác và bỏ chỉ mục trùng/không hợp lệ; input cũ không có trường này vẫn được xử lý. Gói chỉ di chuyển, chỉ bắn hoặc chỉ gửi lệnh không thêm trường mới; phiên bản wire giữ nguyên. Kiểm thử codec xác nhận trường này đi qua binary/delta nguyên vẹn.

### Đạn của súng mới bị về 0 hoặc súng vừa cất bị tự đầy lại

Cơ chế tránh snapshot cũ hoàn lại đạn trước đây chỉ xét súng đang cầm và một thời điểm bắn chung. Sau khi đổi súng, cơ chế này có thể lấy số đạn 0 trước khi sở hữu súng mới để chặn băng đạn host gửi; đồng thời súng vừa bắn rồi cất không còn được bảo vệ.

Client hiện theo dõi thời điểm bắn riêng từng súng. Trong cửa sổ 350 ms, chỉ các súng đó giữ số đạn thấp hơn đã dự đoán; súng khác nhận băng đạn có thẩm quyền bình thường. Reconnect, hồi sinh và chuyển trạng thái xe xóa bảo vệ cũ.

### Súng vừa chọn ở kho trường bắn tạm biến mất khỏi loadout

Trong lúc chờ host xác nhận equip, client giữ tên súng đang cầm nhưng lại nhận danh sách sở hữu và đạn từ snapshot trước lệnh equip. Súng mới có thể biến mất khỏi danh sách hoặc có 0 đạn.

Khi lựa chọn đang được giữ mà snapshot chưa có súng đó, client giữ loadout dự đoán và băng đạn của súng mới đến khi host xác nhận hoặc hết cửa sổ giữ lựa chọn. Các phần inventory khác vẫn nhận trạng thái host.

### Lên/xuống xe bị correction hoặc vault cũ kéo lệch

Correction đi bộ có thể tiếp tục áp vào xe sau khi lên xe; correction lái xe có thể kéo người chơi sau khi xuống. Vault bị ngắt khi lên xe còn có thể chạy tiếp sau khi xuống ở một nơi khác.

Snapshot thay đổi `vehicleId` hiện ngắt nội suy, áp vị trí mới và xóa correction/lịch sử dự đoán cũ. Simulation cũng hủy vault, vận tốc nhảy và tốc độ đi bộ khi lên/xuống xe. Kiểm thử dùng correction thật và vault thật, không đặt trực tiếp các trường correction nội bộ.

### Có thể lên xe xuyên sàn từ tầng trên

Tìm xe gần chỉ xét khoảng cách ngang. Người đứng ở tầng 3 m có thể lên xe dưới đất khi nhấn tương tác. Simulation hiện kiểm tra thêm chênh lệch độ cao tối đa 2 m trước khi chọn xe.

### Súng ở xa không theo vị trí sau full resync

Full resync cập nhật vị trí trên cùng đối tượng loot, nhưng mesh đơn giản ở xa đã đóng băng world matrix. Mesh tiếp tục hiển thị tại chỗ cũ dù vị trí simulation và chỗ nhặt đã thay đổi.

Lượt quét loot hiện mở lại matrix khi phát hiện vị trí thay đổi, cập nhật một lần rồi đóng băng tiếp. Kiểm thử trình duyệt dùng `SnapshotBuilder`/`applySnapshot` thật để di chuyển súng ở xa; trước bản sửa hết hạn chờ vị trí mới, sau bản sửa qua và vẫn kiểm tra chuyển LOD, nhặt súng cùng geometry nguồn nguyên vẹn.

### Kết quả xác minh

10 ca tái hiện trong `tests/net-actions.test.ts` thất bại trước bản sửa và qua sau bản sửa; thêm một ca kiểm tra chỉ mục trùng/không hợp lệ và tương thích input cũ. Toàn bộ 842/842 kiểm thử unit qua; TypeScript và production build qua. Ba bài trình duyệt qua: chat/reconnect native WebRTC, trường bắn ba người có thao tác bắn rồi đổi súng trong cùng gói, và LOD/full resync/nhặt súng. Các bài WebRTC dùng signaling giả lập và DataChannel thật trên máy phát triển, chưa xác minh đường TURN giữa hai mạng bên ngoài.

Log: `output/bug-audit-actions-before.log`, `output/bug-audit-actions-after.log`, `output/bug-audit-actions-full.log`, `output/bug-audit-actions-build.log`, `output/bug-audit-actions-browser.log`, `output/bug-audit-loot-resync-before.log`, `output/bug-audit-loot-resync-after.log`. Các bản sửa của hai vòng rà soát ngày 2026-10-08 vẫn chưa được commit/push.

## Rà soát UI — 2026-10-08

### Kho đồ, kho súng, bản đồ và chat chồng cửa sổ

Kho đồ không đóng kho súng khi mở; kho súng không đóng kho đồ hoặc bản đồ. Mở chat bằng nút khi đang xem bản đồ cũng để cả hai cùng hoạt động. Inventory có thể lấy lại focus khỏi ô chat mỗi lần cập nhật. Menu multiplayer chỉ đóng inventory nên có thể để bản đồ/kho súng ở bên trên hoặc cho mở lại bản đồ bằng nút HUD.

Các luồng mở hiện đóng cửa sổ đang thay thế, giữ focus trong cửa sổ mới và chặn mở kho súng/bản đồ khi menu multiplayer đang mở. Chat đặt focus sau khi callback đóng các cửa sổ khác. Việc chuyển cửa sổ không tự pause trận online.

### Kho súng còn mở sau khi chết hoặc về menu

Kho súng không tham gia cleanup khi phase thay đổi hoặc nhân vật chết. Cửa sổ và ô tìm kiếm có thể còn tồn tại qua lúc hồi sinh/menu; người chết hoặc spectator cũng có thể mở lại kho súng.

Kho súng hiện đóng khi rời trạng thái chơi, chết hoặc spectate; chỉ mở ở trường bắn với nhân vật còn sống và menu pause đóng. Cleanup không tự khóa chuột lại trong menu/death. Bản sửa được kiểm tra cả ở DOM và trong game thật, với ô tìm kiếm đang giữ focus khi nhân vật bị hạ.

### Tab và Enter bị phím tắt game chiếm

Phím Tab từ một nút trong kho súng đi đến handler mở inventory trước khi kiểm tra cửa sổ hiện tại, tạo hai dialog. Trong multiplayer, Enter mở chat trước khi xử lý kho súng/inventory hoặc kích hoạt nút đang focus; Enter trên card súng không equip được.

Handler hiện xét cửa sổ hiện tại trước phím tắt mở cửa sổ khác. Tab tiếp tục điều hướng trong kho súng; Enter kích hoạt nút đang focus theo hành vi trình duyệt. Enter từ canvas vẫn mở chat online. Input, select, textarea và nội dung đang sửa không phát sinh phím điều khiển game.

### Bản đồ desktop vẫn khóa chuột, Esc làm pause trận

Mở bản đồ chỉ báo trạng thái overlay touch nên desktop không nhả pointer lock. Người chơi không có con trỏ để đặt cờ/đóng bản đồ; Esc đi đến pause thay vì chỉ đóng bản đồ.

Bản đồ hiện có callback riêng trên mọi thiết bị: mở nhả chuột/xóa input đang giữ, focus nút đóng; đóng trả focus về canvas khi đang chơi và không có cửa sổ khác. Esc/M đóng riêng bản đồ. Pointer-lock handler nhận diện việc nhả chuột vì overlay để không tự pause. Kiểm thử browser bắt đầu với pointer lock thật, rồi mở bản đồ và xác nhận trận vẫn chơi sau Esc.

### Bản đồ lớn bị cắt mép và toast che tiêu đề

Ở 1280 × 720, map card cao 751 px và bắt đầu tại y=-15 px, cắt cả phần trên/dưới. Điện thoại ngang giới hạn chiều cao card nhưng legend nằm ngoài vùng hiển thị và phải cuộn. Toast z-index 15 còn nằm trước map z-index 4, che vùng tiêu đề/nút đóng.

Card hiện dùng flex với chiều cao theo viewport động: header/legend giữ kích thước, canvas thu theo phần còn lại và vẫn vuông. Map nằm phía trước toast gameplay. Kiểm thử browser kiểm tra card, legend và tỷ lệ canvas ở 1280 × 720, 1024 × 600, 390 × 844 và 844 × 390; có ảnh chụp để kiểm tra trực quan. Không thay phép đổi tọa độ đặt cờ.

### Chat mang trạng thái phòng cũ sang trận mới

Khi rời trận, chat xóa log và số unread nội bộ nhưng không cập nhật badge, xóa bản nháp hoặc đưa hint lỗi về mặc định. Vào phòng mới có thể thấy số tin chưa đọc cũ và gửi nhầm bản nháp trước đó.

Tắt chat khi rời trận hiện đồng bộ badge về ẩn, xóa bản nháp và reset hint. Reconnect vẫn giữ lịch sử/bản nháp trong cùng trận; thay đổi này chỉ reset khi chat bị tắt lúc rời trận.

### Kết quả xác minh

10 ca DOM mới trong `tests/ui-overlays.test.ts` thất bại trước bản sửa và đều qua sau bản sửa. Các ca browser bắt lỗi Tab, Enter, pointer lock thật và layout bản đồ trước bản sửa. Toàn bộ 852/852 kiểm thử unit qua; năm ca browser UI qua, bao gồm desktop và điện thoại dọc/ngang; hai bài multiplayer native WebRTC (chat/reconnect và trường bắn ba người) qua; TypeScript và production build qua. Ảnh chụp đã được kiểm tra trực quan, bao gồm bản đồ điện thoại ngang sau khi sửa lớp toast.

Log: `output/bug-audit-ui-before.log`, `output/bug-audit-ui-targeted.log`, `output/bug-audit-ui-map-before.log`, `output/bug-audit-ui-map-layout-before.log`, `output/bug-audit-ui-browser-after.log`, `output/bug-audit-ui-multiplayer.log`, `output/bug-audit-ui-full.log`, `output/bug-audit-ui-build.log`. Các bản sửa UI và các vòng trước vẫn chưa được commit/push.

## Màn hình chính tràn nội dung ở Chrome 100% — 2026-10-08

Asset UI ghi đè `.lobby-stage` thành `flex: 1 0 auto; min-height: min-content`, nên nội dung bên phải buộc toàn bộ menu cao hơn viewport. Với trường bắn tại 1366 × 768, menu cao 1000 px; tại 1280 × 600 cao 986 px. Ngay cả 1920 × 1080, tab Thiết lập vẫn làm menu cao 1366 px và đẩy thanh chuyển tab/footer ra khỏi màn hình khi cuộn.

Desktop hiện cho stage co theo khoảng trống giữa header/footer; panel giới hạn chiều cao và cuộn nội dung bên trong. Không dùng zoom hay giảm cỡ chữ để ép giao diện vừa màn hình. Scrollbar vẫn ẩn theo yêu cầu trước đó, nhưng bánh xe chuột và cuộn bằng bàn phím hoạt động. Chuyển Thiết lập/Chiến đấu đặt panel về đầu nội dung, tránh mang vị trí cuộn của tab cũ sang tab mới. Các quy tắc scroll mới chỉ áp dụng desktop.

`tests/e2e/menu-layout.e2e.ts` chạy Google Chrome thật với zoom mặc định và deviceScaleFactor 1. Bốn ca tại 1366 × 768, 1280 × 600, 1920 × 1080 và 900 × 700 đều thất bại trước bản sửa và qua sau bản sửa. Mỗi ca thử cả bảy bản đồ, các nút tùy chọn, nút online, chuyển tab, cuộn bánh xe tới cuối Thiết lập và reset vị trí cuộn. 38 kiểm thử UI liên quan qua; TypeScript và production build qua. Ảnh Thiết lập và menu laptop đã được xem để kiểm tra trực quan.

Log: `output/menu-layout-before.log`, `output/menu-layout-after.log`, `output/menu-layout-unit.log`, `output/menu-layout-build.log`. Bản sửa chưa được commit/push.
