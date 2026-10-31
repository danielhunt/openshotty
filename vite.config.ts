import { defineConfig } from 'vite';

// Relative base so the build works from a GitHub Pages project sub-path
// (https://<user>.github.io/monster-hunt-ar/) and from a Pages root deploy.
export default defineConfig({
  base: './',
  // Reachable from anywhere on the network (a phone on the same wifi, a tunnel
  // hostname, a shareable LAN address). Vite's host allow-list is off on
  // purpose: this is a local game build with no secrets in it.
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
    // Vite previews /assets/* as immutable. The bundle names here are
    // deliberately unhashed (the service worker precaches them by name), so
    // without this a rebuild would look like it did nothing.
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  build: {
    target: 'es2022',
    cssMinify: true,
    // three is the only dependency; a single chunk keeps the service worker simple.
    // cssCodeSplit is not needed: one entry point already yields one stylesheet
    // (assets/index.css, which public/sw.js precaches by that exact name).
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
