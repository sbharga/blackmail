import './build-p2p.mjs';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('public', { recursive: true });
for (const file of ['index.html', 'app.js', 'style.css', 'config.js', 'demo.js', 'demo-state.js', 'demo.css', 'messaging.js', 'messaging.css', 'logo.svg', 'p2p.js', 'p2p-session.js', 'peer-ui.js', 'message-delivery.js', 'peer-reconnect.js']) {
  await copyFile(`extension/${file}`, `public/${file}`);
}
console.log('Built BlackMail web client in public/');
