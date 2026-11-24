import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import macros from 'unplugin-parcel-macros';
import { resolve } from 'node:path';

// Main build: side panel (HTML entry) with Spectrum 2 style macros.
// content/background are built as self-contained IIFE bundles via
// ENTRY=content|background (see package.json).
const entry = process.env.ENTRY;
export default defineConfig(
  entry
    ? {
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          target: 'es2022',
          lib: {
            entry: resolve(__dirname, `src/${entry}/index.ts`),
            name: entry,
            formats: ['iife'],
            fileName: () => `${entry}.js`,
          },
        },
      }
    : {
        plugins: [macros.vite(), react()], // macros must be first
        base: './',
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          target: ['es2022'],
          cssMinify: 'lightningcss',
          rollupOptions: {
            input: { sidepanel: resolve(__dirname, 'sidepanel.html') },
            output: {
              // Single shared CSS bundle for S2 + style-macro CSS
              manualChunks(id) {
                if (/macro-(.*)\.css$/.test(id) || /@react-spectrum\/s2\/.*\.css$/.test(id)) {
                  return 's2-styles';
                }
              },
            },
          },
        },
        test: { environment: 'node' },
      },
);
