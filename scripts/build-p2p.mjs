import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc',
  '--strict', '--target', 'ES2022', '--module', 'ES2022', '--lib', 'ES2022,DOM',
  '--skipLibCheck', '--noEmitOnError', '--outDir', 'extension', 'src/utils/p2p.ts',
], { stdio: 'inherit' });
