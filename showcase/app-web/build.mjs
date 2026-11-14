/**
 * Builds the real employee app (bannuar-app) for the browser, for the showcase video: react-native-web
 * stands in for React Native, the stubs/ folder for the phone-only modules, mock.js for Supabase.
 *   APP_DIR=/path/to/bannuar-app node showcase/app-web/build.mjs   → showcase/.out/app-web/index.html
 * The app's own packages must be installed (npm ci in APP_DIR) plus react-native-web, react-dom and
 * esbuild: npm i --no-save react-native-web@0.21.2 react-dom@19.0.0 esbuild@0.25.10
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
// bannuar-app next to bannuar-portal, unless APP_DIR says where it is
const APP = resolve(process.env.APP_DIR || join(here, '../../../bannuar-app'));
const OUT = resolve(here, '../.out/app-web');
const work = join(APP, '.showcase-web');
rmSync(work, { recursive: true, force: true });
cpSync(here, work, { recursive: true, filter: (p) => !p.endsWith('build.mjs') });
const { build } = createRequire(join(APP, 'package.json'))('esbuild');

const stub = (f) => join(work, 'stubs', f);
const MAP = {
  'react-native': stub('react-native.js'),
  '@env': stub('env.js'),
  'react-native-keychain': stub('keychain.js'),
  '@notifee/react-native': stub('noop.js'),
  '@react-native-firebase/app': stub('noop.js'),
  '@react-native-firebase/messaging': stub('noop.js'),
  'react-native-bootsplash': stub('noop.js'),
  '@react-native-community/geolocation': stub('geolocation.js'),
  'react-native-image-picker': stub('image-picker.js'),
  '@react-native-documents/picker': stub('documents-picker.js'),
  'react-native-blob-util': stub('blob-util.js'),
  'react-native-url-polyfill/auto': stub('empty.js'),
};
const swap = {
  name: 'showcase-swap',
  setup(b) {
    b.onResolve({ filter: /^[@a-z]/ }, (args) => {
      if (MAP[args.path] && !(args.path === 'react-native' && args.importer === MAP['react-native'])) return { path: MAP[args.path] };
      // React Native internals some libraries reach for: nothing to do in a browser
      if (args.path.startsWith('react-native/')) return { path: stub('noop.js') };
      return undefined;
    });
  },
};

mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: [join(work, 'index.js')],
  bundle: true,
  outfile: join(OUT, 'app.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl', '.ttf': 'file' },
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.jsx', '.json'],
  mainFields: ['browser', 'module', 'main'],
  define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"', global: 'window' },
  plugins: [swap],
  logLevel: 'warning',
  absWorkingDir: APP,
});
const FONTS = ['Archivo-Regular', 'Archivo-SemiBold', 'Archivo-Bold', 'ArchivoExpanded-Bold', 'ArchivoCondensed-SemiBold'];
for (const f of FONTS) copyFileSync(join(APP, 'src/assets/fonts', `${f}.ttf`), join(OUT, `${f}.ttf`));
writeFileSync(join(OUT, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bannuar app (showcase)</title>
<style>
${FONTS.map((f) => `@font-face { font-family: '${f}'; src: url('${f}.ttf') format('truetype'); font-display: block; }`).join('\n')}
html, body, #root { margin: 0; height: 100%; overflow: hidden; }
#root { display: flex; }
* { -webkit-tap-highlight-color: transparent; }
::-webkit-scrollbar { width: 0; height: 0; }
</style></head>
<body><div id="root"></div><script src="app.js"></script></body></html>
`);
rmSync(work, { recursive: true, force: true });
console.log(`Built the app for the browser: ${OUT}/index.html`);
