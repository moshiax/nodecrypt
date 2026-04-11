const TOKEN_PREFIX = 'nct1.';

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

export function buildRoomToken({ server, masterKey, roomName, password }) {
	const payload = {
		s: server || '',
		m: masterKey || '',
		r: roomName || '',
		p: password || ''
	};
	return `${TOKEN_PREFIX}${toBase64Url(JSON.stringify(payload))}`;
}

export function buildRoomLink(token) {
	if (!token) return `${location.origin}${location.pathname}`;
	return `${location.origin}${location.pathname}#token=${encodeURIComponent(token)}`;
}

export function parseRoomToken(value) {
	const raw = String(value || '').trim();
	if (!raw.startsWith(TOKEN_PREFIX)) return null;
	try {
		const decoded = fromBase64Url(raw.slice(TOKEN_PREFIX.length));
		const payload = JSON.parse(decoded);
		if (!payload || typeof payload !== 'object') return null;
		return {
			server: String(payload.s || ''),
			masterKey: String(payload.m || ''),
			roomName: String(payload.r || ''),
			password: String(payload.p || '')
		};
	} catch {
		return null;
	}
}

export function parseRoomTokenFromLocation() {
	const hash = String(window.location.hash || '');
	if (!hash.startsWith('#')) return null;
	const params = new URLSearchParams(hash.slice(1));
	return parseRoomToken(params.get('token'));
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
