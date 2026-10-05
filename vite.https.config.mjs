// `npm run dev:https`: the same dev server over HTTPS with a self-signed certificate, reachable from a phone on the
// same Wi-Fi. Browsers only give a page the phone's motion sensors (gyroscope aiming) when it is served over HTTPS.
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true },
});
