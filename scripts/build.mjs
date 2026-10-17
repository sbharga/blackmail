import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('public', { recursive: true });
for (const file of ['index.html', 'app.js', 'style.css', 'config.js', 'demo.js', 'demo-state.js', 'demo.css']) {
  await copyFile(`extension/${file}`, `public/${file}`);
}
console.log('Built BlackMail web client in public/');
