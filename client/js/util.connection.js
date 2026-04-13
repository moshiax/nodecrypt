const TOKEN_PREFIX = 'nct.';
const TOKEN_KDF_ITERATIONS = 2_000_000;

function toBase64Url(str) {
	return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str) {
	const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	return decodeURIComponent(escape(atob(padded)));
}

export function normalizeServerInput(raw) {
	const value = String(raw || '').trim();
	if (!value) return '';
	if (/^(https?:\/\/|wss?:\/\/)/i.test(value)) return value;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return '';
	if (/^file:/i.test(value)) return '';
	return `https://${value}`;
}

export function resolveServerWebSocketAddress(raw) {
	const normalized = normalizeServerInput(raw);
	if (!normalized) {
		const secure = window.location.protocol === 'https:';
		return {
			serverInput: `${window.location.origin}`,
			wsAddress: `${secure ? 'wss' : 'ws'}://${window.location.host}/ws`,
			domainKey: window.location.host,
			displayHost: window.location.host,
			wsProtocol: secure ? 'wss' : 'ws'
		};
	}
	const parsed = new URL(normalized);
	const proto = parsed.protocol.toLowerCase();
	const isWs = proto === 'ws:' || proto === 'wss:';
	const wsProtocol = isWs ? proto.slice(0, -1) : (proto === 'https:' ? 'wss' : 'ws');
	const host = parsed.host;
	const path = (parsed.pathname && parsed.pathname !== '/') ? parsed.pathname.replace(/\/+$/, '') : '/ws';
	return {
		serverInput: normalized,
		wsAddress: `${wsProtocol}://${host}${path}`,
		domainKey: host,
		displayHost: host,
		wsProtocol
	};
}

export function getServerAutocompleteOptions() {
	const isValid = (value) => {
		try {
			const parsed = new URL(String(value || '').trim());
			return /^(https?:|wss?:)$/i.test(parsed.protocol);
		} catch {
			return false;
		}
	};

	const currentOrigin = isValid(window.location.origin) ? window.location.origin : '';

	return [
		currentOrigin,
		...loadRecentServers().filter(isValid)
	]
		.filter(Boolean)
		.filter((item, index, list) => list.indexOf(item) === index);
}

export async function buildRoomToken({ server, masterKey, roomName, password }, sharePassword = '') {
	const payload = {
		s: server || '',
		m: masterKey || '',
		r: roomName || '',
		p: password || ''
	};
	if (!sharePassword) return `${TOKEN_PREFIX}${toBase64Url(JSON.stringify({ v: 2, e: 0, d: payload }))}`;
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveShareKey(sharePassword, salt);
	const plaintext = new TextEncoder().encode(JSON.stringify(payload));
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
	const tokenPayload = {
		v: 2,
		e: 1,
		s: toBase64UrlBytes(salt),
		i: toBase64UrlBytes(iv),
		c: toBase64UrlBytes(new Uint8Array(cipher))
	};
	return `${TOKEN_PREFIX}${toBase64Url(JSON.stringify(tokenPayload))}`;
}

function toBase64UrlBytes(bytes) {
	return toBase64Url(String.fromCharCode(...bytes));
}

function fromBase64UrlBytes(value) {
	return Uint8Array.from(fromBase64Url(value), (ch) => ch.charCodeAt(0));
}

async function deriveShareKey(sharePassword, salt) {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(String(sharePassword || '')),
		'PBKDF2',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt,
			iterations: TOKEN_KDF_ITERATIONS
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export function buildRoomLink(token) {
	return `${location.origin}${location.pathname}`;
}

export async function parseRoomToken(value, passwordProvider = null) {
	const raw = String(value || '').trim();
	if (!raw.startsWith(TOKEN_PREFIX)) return null;
	try {
		const decoded = fromBase64Url(raw.slice(TOKEN_PREFIX.length));
		const payload = JSON.parse(decoded);
		if (!payload || typeof payload !== 'object') return null;
		if (payload.e === 1) {
			if (typeof passwordProvider !== 'function') return null;
			const salt = fromBase64UrlBytes(String(payload.s || ''));
			const iv = fromBase64UrlBytes(String(payload.i || ''));
			const cipher = fromBase64UrlBytes(String(payload.c || ''));
			const decryptWithPassword = async (sharePassword) => {
				try {
					if (!sharePassword) return null;
					const key = await deriveShareKey(sharePassword, salt);
					const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
					return JSON.parse(new TextDecoder().decode(decrypted));
				} catch {
					return null;
				}
			};
			const providerResult = await passwordProvider(decryptWithPassword);
			if (!providerResult) return null;
			const parsedData = (typeof providerResult === 'object')
				? providerResult
				: await decryptWithPassword(providerResult);
			if (!parsedData || typeof parsedData !== 'object') return null;
			return {
				server: String(parsedData.s || ''),
				masterKey: String(parsedData.m || ''),
				roomName: String(parsedData.r || ''),
				password: String(parsedData.p || '')
			};
		}
		const data = payload.d || payload;
		return {
			server: String(data.s || ''),
			masterKey: String(data.m || ''),
			roomName: String(data.r || ''),
			password: String(data.p || '')
		};
	} catch {
		return null;
	}
}

export function loadRecentServers() {
	try {
		const list = JSON.parse(localStorage.getItem('nodecrypt_recent_servers_v1') || '[]');
		return Array.isArray(list) ? list.filter(Boolean) : [];
	} catch {
		return [];
	}
}

export function rememberServer(server) {
	const normalized = normalizeServerInput(server);
	if (!normalized) return;
	const existing = loadRecentServers().filter((item) => item !== normalized);
	const updated = [normalized, ...existing].slice(0, 8);
	localStorage.setItem('nodecrypt_recent_servers_v1', JSON.stringify(updated));
}
