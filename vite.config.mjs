import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
	const isSingleFile = mode === 'singlefile';
	return {
		root: 'client',
		base: './',
		plugins: isSingleFile ? [viteSingleFile()] : [],
		build: {
			outDir: '../dist',
			emptyOutDir: true,
			minify: 'terser',
			assetsInlineLimit: isSingleFile ? Number.MAX_SAFE_INTEGER : undefined,

			terserOptions: {
				compress: {
					drop_console: false,
					drop_debugger: false
				}
			},
			rollupOptions: {
				input: 'client/index.html',
				output: {
					manualChunks: isSingleFile ? undefined : (id) => {
						if (id.includes('node_modules')) {
							return 'vendor-deps';
						}
						return undefined;
					}
				}
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
			include: ['buffer', 'elliptic'],
		},
	};
});
