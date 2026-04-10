// Crypto utilities with LRU memoization helpers

function arrayBufferToBase64(buffer) {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function serializeArg(arg) {
	if (arg instanceof Uint8Array || arg instanceof ArrayBuffer) return arrayBufferToBase64(arg);
	if (arg && typeof arg === 'object') return JSON.stringify(arg, Object.keys(arg).sort());
	return String(arg);
}

function getSize(value) {
	if (value instanceof ArrayBuffer) return value.byteLength;
	if (value instanceof Uint8Array) return value.byteLength;
	if (typeof value === 'string') return value.length * 2;
	if (typeof value === 'object' && value !== null) {
		return new TextEncoder().encode(JSON.stringify(value)).length;
	}
	return 0;
}

function cacheAsync(fn, limit = 3000, name = '') {
	const cache = new Map();
	const fnName = name || fn?.name || 'anonymous';

	function touch(key, value) {
		cache.delete(key);
		cache.set(key, value);
	}

	function evict() {
		if (cache.size > limit) {
			const firstKey = cache.keys().next().value;
			cache.delete(firstKey);
		}
	}

	return async (...args) => {
		const key = args.map(serializeArg).join('|');
		const start = performance.now();

		if (cache.has(key)) {
			const promise = cache.get(key);
			touch(key, promise);
			const result = await promise;

			let totalUnits = 0;
			for (const v of cache.values()) totalUnits += getSize(await v);

			console.log(`[Cached - ${fnName}]: ${performance.now() - start} ms, cache size: ${totalUnits} units`);
			return result;
		}

		const promise = Promise.resolve(fn(...args));
		cache.set(key, promise);
		evict();

		const result = await promise;

		let totalUnits = 0;
		for (const v of cache.values()) totalUnits += getSize(await v);

		console.log(`[Executed - ${fnName}]: ${performance.now() - start} ms, cache size: ${totalUnits} units`);
		return result;
	};
}

async function sha256HexRaw(input) {
	const normalized = input instanceof Uint8Array || input instanceof ArrayBuffer ? input : new TextEncoder().encode(String(input));
	const digest = await crypto.subtle.digest('SHA-256', normalized);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const sha256Hex = cacheAsync(sha256HexRaw, 1000, 'sha256HexRaw');

export {
	serializeArg,
	getSize,
	cacheAsync,
	sha256Hex
};
