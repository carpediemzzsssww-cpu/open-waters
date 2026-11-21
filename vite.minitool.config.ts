import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

const local = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Geometry, textures and audio are generated locally. Drop Three's unused file loaders and XR adapter.
function offlineThree(): Plugin {
  return {
    name: 'offline-three',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/destinations/catalog.ts')) {
        // One local script runs in a classic WebView. Keep the web atlas's lazy routes intact.
        const imports: string[] = [];
        const body = code.replace(/import\(\s*(['"])(\.\/[a-zA-Z0-9_/-]+)\1\s*\)/g, (_all, _quote, id: string) => {
          const localName = 'localVoyage' + imports.length;
          imports.push(`import * as ${localName} from ${JSON.stringify(id)};`);
          return 'Promise.resolve(' + localName + ')';
        });
        if (body.includes('import(')) this.error('Mini voyages must use a relative import with a literal route path.');
        return imports.join('\n') + '\n' + body;
      }
      if (!/\/three\/build\/three\.(core|module)\.js$/.test(id)) return;
      let src = code;
      if (src.includes('new WeakRef(')) {
        // Three r187 tracks uploaded resources with ES2021 weak references.
        // Older WebViews use explicit disposal when leaving a voyage or losing the context.
        src = src.replaceAll('new WeakRef(', 'new ResourceRef(')
          .replaceAll('new FinalizationRegistry(', 'new CleanupRegistry(');
        src = `const nativeCleanup = typeof WeakRef === 'function' && typeof FinalizationRegistry === 'function';
const ResourceRef = nativeCleanup ? WeakRef : class { constructor(value) { this.value = value; } deref() { return this.value; } };
const CleanupRegistry = nativeCleanup ? FinalizationRegistry : class { register() {} unregister() {} };
` + src;
      }
      if (src.includes('fetch(')) {
        src = 'function offlineResource(){return Promise.reject(Error("Offline package"))}\n' + src.replace(/\bfetch\(/g,'offlineResource(');
      }
      if (src.includes('class WebXRManager')) {
        const node = this.parse(src).body.find(n => n.type === 'ClassDeclaration' && n.id?.name === 'WebXRManager');
        if (!node) this.error('Unsupported Three.js XR adapter');
        const xr = 'class WebXRManager extends EventDispatcher{constructor(){super();this.enabled=false;this.isPresenting=false;this.cameraAutoUpdate=false}getSession(){return null}getCamera(){return null}setAnimationLoop(){}dispose(){}getEnvironmentBlendMode(){return "opaque"}hasDepthSensing(){return false}getDepthSensingMesh(){return null}}';
        src = src.slice(0,node.start)+xr+src.slice(node.end);
      }
      return src;
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [offlineThree()],
  resolve: {
    preserveSymlinks: true,
    alias: [
      { find: './ui/time-panel', replacement: local('./src/minitool/time-panel.ts') },
      { find: './ui/hud', replacement: local('./src/minitool/hud.ts') },
      { find: './style.css', replacement: local('./src/minitool/mini.css') },
    ],
  },
  build: {
    outDir: 'dist-minitool',
    target: ['es2017','chrome61'],
    cssTarget: 'chrome61',
    modulePreload: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: 'src/minitool/entry.ts',
      output: { format: 'iife', codeSplitting: false, entryFileNames: 'app.js', assetFileNames: 'app[extname]' },
    },
  },
});
