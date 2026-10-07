/** Guests choose the route before discovery; hosts apply it independently to each guest. */
export type ConnectionMode = 'p2p' | 'turn';

export function connectionConfiguration(configuration: RTCConfiguration, mode?: ConnectionMode): RTCConfiguration {
  if (!mode) return configuration;
  if (mode === 'turn') {
    if (!configuration.iceServers?.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/i.test(url)))) {
      throw new Error('Chưa có cấu hình TURN. Hãy chọn P2P hoặc cấu hình dịch vụ TURN trước.');
    }
    return { ...configuration, iceTransportPolicy: 'relay' };
  }
  const iceServers = (configuration.iceServers ?? []).flatMap(server => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(url => /^stuns?:/i.test(url));
    return urls.length ? [{ urls }] : [];
  });
  return { ...configuration, iceTransportPolicy: 'all', iceServers };
}
