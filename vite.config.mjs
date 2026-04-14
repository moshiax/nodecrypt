import { defineConfig } from 'vite';
import { splitVendorChunkPlugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';

function inlineFavicon() {
	const svg = fs.readFileSync('client/assets/favicon.svg', 'utf-8');
	const encoded = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

	return {
		name: 'inline-favicon',
		enforce: 'post',

		generateBundle(_, bundle) {
			for (const fileName in bundle) {
				const file = bundle[fileName];

				if (file.type === 'asset' && file.fileName.endsWith('.html')) {
					file.source = file.source.replace(
						/<link[^>]+rel=["']icon["'][^>]*>/,
						`<link rel="icon" href="${encoded}">`
					);
				}

				if (
					file.type === 'asset' &&
					file.fileName.includes('favicon') &&
					file.fileName.endsWith('.svg')
				) {
					delete bundle[fileName];
				}
			}
		}
	};
}

export default defineConfig(({ mode }) => {
	const isSingleFile = mode === 'singlefile';
	return {
		root: 'client',
		base: './',
		plugins: isSingleFile
			? [viteSingleFile(), inlineFavicon()]
			: [splitVendorChunkPlugin()],

		build: {
			outDir: '../dist',
			emptyOutDir: true,
			minify: 'esbuild',
			assetsInlineLimit: isSingleFile ? Number.MAX_SAFE_INTEGER : undefined,

			rollupOptions: {
				input: 'client/index.html',
				output: isSingleFile
					? undefined
					: {}
			},
			sourcemap: false,
			cssCodeSplit: !isSingleFile,
			chunkSizeWarningLimit: 1000,
		},
		resolve: {
			alias: {
				buffer: 'buffer',
			},
		},
		server: {
			hmr: true,
			open: true,
		},
		optimizeDeps: {
			include: ['buffer'],
		},
	};
});
