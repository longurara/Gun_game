/** Lightweight briefing screen: DOM/CSS and a copy of the existing map preview. */
export const loadingScreen = `<section id="loading-screen" class="loading-screen" aria-labelledby="loading-title" hidden>
  <header class="loading-header">
    <div class="loading-brand"><span class="loading-brand-mark" aria-hidden="true">L<span></span></span><span>LASTLIGHT<small>VÙNG SỐNG CUỐI CÙNG</small></span></div>
    <span class="loading-channel"><i aria-hidden="true"></i>ĐANG CHUẨN BỊ</span>
  </header>
  <div class="loading-briefing">
    <div class="loading-copy">
      <p class="loading-eyebrow"><span></span>GIỮ VỮNG VỊ TRÍ</p>
      <h1 id="loading-title">CHUẨN BỊ<br><em>XUẤT KÍCH.</em></h1>
      <p class="loading-intro">Kiểm tra trang bị. Làm chủ chiến trường.<br>Mỗi quyết định đều có thể là quyết định cuối cùng.</p>
      <div class="loading-mission"><span class="loading-mission-icon" aria-hidden="true">⌖</span><div><small>CHIẾN TRƯỜNG</small><strong id="loading-map">ĐẢO LASTLIGHT</strong></div><span id="loading-map-size">4 × 4 KM</span></div>
    </div>
    <div class="loading-intel" aria-hidden="true">
      <div class="loading-intel-header"><span>BẢN ĐỒ TÁC CHIẾN</span><span id="loading-map-code">ISLAND</span></div>
      <div class="loading-radar">
        <canvas id="loading-map-canvas" width="320" height="320"></canvas>
        <div class="loading-radar-grid"></div><div class="loading-radar-sweep"></div>
        <div class="loading-radar-rings"></div><span class="loading-radar-north">N</span>
        <i class="loading-radar-point point-a"></i><i class="loading-radar-point point-b"></i><i class="loading-radar-point point-c"></i>
        <div class="loading-radar-center"><span></span></div>
      </div>
      <div class="loading-intel-footer"><span><i></i>QUÉT KHU VỰC</span><span>LASTLIGHT / TACTICAL</span></div>
    </div>
  </div>
  <footer class="loading-footer">
    <div class="loading-transfer">
      <div class="loading-status"><p id="loading-text" role="status" aria-live="polite" aria-atomic="true">Đang chuẩn bị chiến trường…</p><span id="loading-step-count">01 / 03</span></div>
      <ol class="loading-steps" aria-label="Các bước chuẩn bị">
        <li data-state="active"><span class="loading-step-bar"></span><span><b>01</b> KHỞI TẠO</span></li>
        <li data-state="pending"><span class="loading-step-bar"></span><span><b>02</b> TRANG BỊ</span></li>
        <li data-state="pending"><span class="loading-step-bar"></span><span><b>03</b> CHIẾN TRƯỜNG</span></li>
      </ol>
    </div>
    <aside class="loading-tip"><span>MẸO SINH TỒN</span><p>Đổi vị trí sau khi khai hỏa. Đừng để đối thủ đoán được nơi bạn ẩn nấp.</p></aside>
  </footer>
</section>`;

/** Let the browser paint the new stage before synchronous GPU/world setup. */
export function paintLoadingScreen(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Start once when loading becomes visible; asset preparation runs during this hold. */
export function holdLoadingScreen(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
}
