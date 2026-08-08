// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages のプロジェクトページはサブパス配信になる。
// base を忘れるとアセットが全部 404 になるため、必ず両方設定する。
export default defineConfig({
  site: 'https://tmokmss.github.io',
  base: '/easy-books',
  output: 'static',
});
