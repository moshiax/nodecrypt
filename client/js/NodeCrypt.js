// NodeCrypt core cryptographic client for secure chat
// NodeCrypt 安全聊天的核心加密客户端

import {
	sha256
} from 'js-sha256';
import {
	formatFingerprintColon
} from './util.avatar.js';
import {
	t
} from './util.i18n.js';
import {
	ec as elliptic
} from 'elliptic';
import {
	Buffer
} from 'buffer';
window.Buffer = Buffer;

// Main NodeCrypt class for secure communication
// 用于安全通信的 NodeCrypt 主类
class NodeCrypt {
	// Initialize NodeCrypt instance
	// 初始化 NodeCrypt 实例
	constructor(config = {}, callbacks = {}) {
		this.config = {
			rsaPublic: config.rsaPublic || '',
			wsAddress: config.wsAddress || '',
			reconnectDelay: config.reconnectDelay || 3000,
			pingInterval: config.pingInterval || 20000,
			debug: config.debug || false,
		};
		this.callbacks = {
			onServerClosed: callbacks.onServerClosed || null,
			onServerSecured: callbacks.onServerSecured || null,
			onClientSecured: callbacks.onClientSecured || null,
			onClientList: callbacks.onClientList || null,
			onClientMessage: callbacks.onClientMessage || null,
		};
		try {
			this.clientEc = new elliptic('curve25519')
		} catch (error) {
			this.logEvent('constructor', error, 'error')
		}
		this.serverKeys = null;
		this.serverShared = null;
		this.serverMasterKey = null;
		this.masterKeyVerification = null;
		this.trustRejected = false;
		this.pendingServerHandshakePacket = null;
		this.credentials = null;
		this.connection = null;
		this.reconnect = null;
		this.ping = null;
		this.lastOutboundAt = 0;
		this.channel = {};
		this.identityKeys = null;
		this.identityPublicHex = '';
		this.identityFingerprint = '';
		this.setCredentials = this.setCredentials.bind(this);
		this.connect = this.connect.bind(this);
		this.destruct = this.destruct.bind(this);
		this.onOpen = this.onOpen.bind(this);
		this.onMessage = this.onMessage.bind(this);
		this.onError = this.onError.bind(this);
		this.onClose = this.onClose.bind(this);
		this.logEvent = this.logEvent.bind(this);
		this.isOpen = this.isOpen.bind(this);
		this.isClosed = this.isClosed.bind(this);
		this.startReconnect = this.startReconnect.bind(this);
		this.stopReconnect = this.stopReconnect.bind(this);
		this.startPing = this.startPing.bind(this);
		this.stopPing = this.stopPing.bind(this);
		this.disconnect = this.disconnect.bind(this);
		this.sendMessage = this.sendMessage.bind(this);
		this.sendChannelMessage = this.sendChannelMessage.bind(this);
		this.encryptServerMessage = this.encryptServerMessage.bind(this);
		this.decryptServerMessage = this.decryptServerMessage.bind(this);
		this.encryptClientMessage = this.encryptClientMessage.bind(this);
		this.decryptClientMessage = this.decryptClientMessage.bind(this)
	}

	async deriveRoomPasswordKey(password, channelHash) {
		const encoder = new TextEncoder();
		const passwordBytes = encoder.encode(password || '');
		const saltBytes = encoder.encode(`nodecrypt-room-kdf-v1:${channelHash || ''}`);
		const baseKey = await crypto.subtle.importKey('raw', passwordBytes, { name: 'PBKDF2' }, false, ['deriveBits']);
		const derivedBits = await crypto.subtle.deriveBits({
			name: 'PBKDF2', salt: saltBytes, iterations: 600000, hash: 'SHA-256'
		}, baseKey, 256);
		return new Uint8Array(derivedBits);
	}

	hexToBytes(hex) {
		if (!this.isString(hex) || !hex.match(/^[0-9a-f]+$/i) || hex.length % 2 !== 0) {
			return new Uint8Array();
		}
		const bytes = new Uint8Array(hex.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
		}
		return bytes;
	}

	concatBytes(first, second) {
		const left = (first instanceof Uint8Array ? first : new Uint8Array(first || []));
		const right = (second instanceof Uint8Array ? second : new Uint8Array(second || []));
		const out = new Uint8Array(left.length + right.length);
		out.set(left, 0);
		out.set(right, left.length);
		return out;
	}

	async derivePeerSharedKey(ecdhSecret, passwordKey, channelHash) {
		const ecdhBytes = (ecdhSecret instanceof Uint8Array ? ecdhSecret : new Uint8Array(ecdhSecret || []));
		const passwordBytes = (passwordKey instanceof Uint8Array ? passwordKey : new Uint8Array(passwordKey || []));
		if (ecdhBytes.length !== 32 || passwordBytes.length !== 32) {
			return null;
		}
		const ikm = this.concatBytes(ecdhBytes, passwordBytes);
		const salt = this.hexToBytes(channelHash || '');
		const hkdfBaseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
		const derivedBits = await crypto.subtle.deriveBits({
			name: 'HKDF',
			hash: 'SHA-256',
			salt: salt,
			info: new TextEncoder().encode('nodecrypt-client-v2')
		}, hkdfBaseKey, 256);
		return new Uint8Array(derivedBits);
	}

	getKeyMeta(publicKeyHex) {
		const keyHash = sha256(String(publicKeyHex));
		return {
			publicKey: publicKeyHex,
			fingerprint: formatFingerprintColon(keyHash, 16)
		}
	}

	getDomainTrustStore() {
		try {
			return JSON.parse(localStorage.getItem('nodecrypt_masterkeys_v1') || '{}')
		} catch (error) {
			this.logEvent('getDomainTrustStore', error, 'error');
			return {}
		}
	}

	saveDomainTrustStore(store) {
		try {
			localStorage.setItem('nodecrypt_masterkeys_v1', JSON.stringify(store))
		} catch (error) {
			this.logEvent('saveDomainTrustStore', error, 'error')
		}
	}

	getDomainTrustKey() {
		try {
			return (window && window.location && window.location.host) ? window.location.host : this.config.wsAddress
		} catch (error) {
			this.logEvent('getDomainTrustKey', error, 'error');
			return this.config.wsAddress
		}
	}

	createSecurityModal({
		title = t('security.modal_title'),
		message = '',
		details = '',
		confirmText = t('security.trust_key'),
		cancelText = t('file.cancel'),
		showCancel = true,
		danger = false
	} = {}) {
		return new Promise((resolve) => {
			const overlay = document.createElement('div');
			overlay.className = 'security-modal-bg';
			const card = document.createElement('div');
			card.className = 'security-modal-card' + (danger ? ' security-modal-card-danger' : '');

			const header = document.createElement('div');
			header.className = 'security-modal-header';
			const titleEl = document.createElement('h3');
			titleEl.textContent = title;
			header.appendChild(titleEl);

			const body = document.createElement('div');
			body.className = 'security-modal-body';
			const messageEl = document.createElement('p');
			messageEl.textContent = message;
			body.appendChild(messageEl);
			if (details) {
				const detailsEl = document.createElement('pre');
				detailsEl.className = 'security-modal-details';
				detailsEl.textContent = details;
				body.appendChild(detailsEl)
			}

			const actions = document.createElement('div');
			actions.className = 'security-modal-actions';

			const finish = (result) => {
				try {
					document.body.classList.remove('security-modal-open');
					overlay.remove()
				} catch (error) {
					this.logEvent('createSecurityModal-finish', error, 'error')
				}
				resolve(result)
			};

			if (showCancel) {
				const secondaryBtn = document.createElement('button');
				secondaryBtn.className = 'security-modal-btn security-modal-btn-secondary';
				secondaryBtn.textContent = cancelText;
				secondaryBtn.addEventListener('click', () => finish(false));
				actions.appendChild(secondaryBtn)
			}

			const primaryBtn = document.createElement('button');
			primaryBtn.className = 'security-modal-btn security-modal-btn-primary';
			primaryBtn.textContent = confirmText;
			primaryBtn.addEventListener('click', () => finish(true));
			actions.appendChild(primaryBtn);

			card.appendChild(header);
			card.appendChild(body);
			card.appendChild(actions);
			overlay.appendChild(card);
			document.body.appendChild(overlay);
			document.body.classList.add('security-modal-open');

			overlay.addEventListener('click', (event) => {
				if (event.target === overlay) {
					finish(false)
				}
			});
		})
	}

	async getMasterKeyFingerprint(base64Key) {
		const keyBytes = Buffer.from(base64Key, 'base64');
		const digest = await crypto.subtle.digest('SHA-256', keyBytes);
		const hashHex = Buffer.from(digest).toString('hex');
		const fullFingerprint = formatFingerprintColon(hashHex, 32);
		return {
			hash: hashHex,
			display: fullFingerprint
		}
	}

	forceResetLoginButtons() {
		try {
			document.querySelectorAll('.login-btn').forEach((btn) => {
				btn.disabled = false;
				btn.innerText = t('ui.enter')
			})
		} catch (error) {
			this.logEvent('forceResetLoginButtons', error, 'error')
		}
	}

	// Set user credentials (username, channel, password)
	// 设置用户凭证（用户名、频道、密码）
	async setCredentials(username, channel, password) {
		this.logEvent('setCredentials');
		try {
			const channelHash = sha256(channel);
			const passwordKey = await this.deriveRoomPasswordKey(password, channelHash);
			this.credentials = {
				username: username,
				channel: channelHash,
				passwordKey: passwordKey
			}
		} catch (error) {
			this.logEvent('setCredentials', error, 'error');
			return (false)
		}
		return (true)
	}

	// Connect to the server
	// 连接到服务器
	connect() {
		if (!this.credentials) {
			return (false)
		}
		this.logEvent('connect', this.config.wsAddress);
		this.stopReconnect();
		this.stopPing();
		this.serverKeys = null;
		this.serverShared = null;
		this.serverMasterKey = null;
		this.masterKeyVerification = null;
		this.trustRejected = false;
		this.pendingServerHandshakePacket = null;
		this.channel = {};
		this.identityKeys = this.clientEc ? this.clientEc.genKeyPair() : null;
		this.identityPublicHex = this.identityKeys ? this.identityKeys.getPublic('hex') : '';
		const identityMeta = this.getKeyMeta(this.identityPublicHex);
		this.identityFingerprint = identityMeta.fingerprint;
		this.lastOutboundAt = 0;
		try {
			this.connection = new WebSocket(this.config.wsAddress);
			this.connection.onopen = this.onOpen;
			this.connection.onmessage = this.onMessage;
			this.connection.onerror = this.onError;
			this.connection.onclose = this.onClose
		} catch (error) {
			this.logEvent('connect', error, 'error');
			return (false)
		}
		return (true)
	}

	// Clean up and disconnect
	// 清理并断开连接
	destruct() {
		this.logEvent('destruct');
		this.stopReconnect();
		this.stopPing();
		this.reconnect = null;
		this.ping = null;
		this.config = {
			rsaPublic: '',
			wsAddress: '',
			reconnectDelay: 3000,
			pingInterval: 15000,
			debug: false,
		};
		this.callbacks.onServerClosed = null;
		this.callbacks.onServerSecured = null;
		this.callbacks.onClientSecured = null;
		this.callbacks.onClientList = null;
		this.callbacks.onClientMessage = null;
		this.clientEc = null;
		this.serverKeys = null;
		this.serverShared = null;
		this.serverMasterKey = null;
		this.masterKeyVerification = null;
		this.trustRejected = false;
		this.pendingServerHandshakePacket = null;
		this.credentials = null;
		this.connection.onopen = null;
		this.connection.onmessage = null;
		this.connection.onerror = null;
		this.connection.onclose = null;
		try {
			this.connection.removeAllListeners()
		} catch (error) {
			this.logEvent('destruct', error, 'error')
		}
		try {
			this.connection.close()
		} catch (error) {
			this.logEvent('destruct', error, 'error')
		}
		this.connection = null;
		this.channel = {};
		this.identityKeys = null;
		this.identityPublicHex = '';
		this.identityFingerprint = '';
		this.lastOutboundAt = 0;
		return (true)
	}

	// WebSocket open event handler
	// WebSocket 连接打开事件处理
	async onOpen() {
		this.logEvent('onOpen');
		this.startPing();
		try {
			this.serverKeys = await crypto.subtle.generateKey({
				name: 'ECDH',
				namedCurve: 'P-384'
			}, false, ['deriveKey', 'deriveBits']);
			this.serverShared = null;
			this.sendMessage(Buffer.from(await crypto.subtle.exportKey('raw', this.serverKeys.publicKey)).toString('hex'))
		} catch (error) {
			this.logEvent('onOpen', error, 'error')
		}
	}

	// WebSocket message event handler
	// WebSocket 消息事件处理
	async onMessage(event) {
		if (!event || !this.isString(event.data)) {
			return
		}
		if (event.data === 'pong') {
			return
		}
		this.logEvent('onMessage', event.data);
		try {
			const data = JSON.parse(event.data);
			if (data.type === 'master-key') {
				if (!this.masterKeyVerification) {
					this.masterKeyVerification = this.handleMasterKey(data)
				}
				const result = await this.masterKeyVerification;
					if (!result) {
						this.trustRejected = true;
						this.stopReconnect();
						this.credentials = null;
						this.forceResetLoginButtons();
						this.disconnect();
					if (this.callbacks.onServerClosed) {
						try {
							this.callbacks.onServerClosed()
						} catch (error) {
							this.logEvent('onMessage-server-closed-callback', error, 'error')
						}
					}
				}
				return
			}
			if (this.masterKeyVerification) {
				const verified = await this.masterKeyVerification;
				if (!verified) {
					return
				}
			}
				if (data.type === 'server-key') {
					const result = await this.handleServerKey(data.key, data.sig);
					if (!result) {
						return
					}
					if (this.pendingServerHandshakePacket && !this.serverShared) {
						const pending = this.pendingServerHandshakePacket;
						this.pendingServerHandshakePacket = null;
						await this.processServerHandshakePacket(pending);
					}
					return
				}
			} catch (e) {}
			if (!this.serverShared) {
				await this.processServerHandshakePacket(event.data);
				return
			}
		const serverDecrypted = await this.decryptServerMessage(event.data, this.serverShared);
		this.logEvent('onMessage-server-decrypted', serverDecrypted);
		if (!this.isObject(serverDecrypted) || !this.isString(serverDecrypted.a)) {
			return
		}
		if (serverDecrypted.a === 'l' && this.isArray(serverDecrypted.p)) {
			try {
				for (const clientId in this.channel) {
					if (serverDecrypted.p.indexOf(clientId) < 0) {
						delete(this.channel[clientId])
					}
				}
				let payloads = {};
				for (const clientId of serverDecrypted.p) {
					if (!this.channel[clientId]) {
						this.channel[clientId] = {
							username: null,
							keys: this.identityKeys,
							publicKey: '',
							fingerprint: '',
							shared: null,
						};
						payloads[clientId] = this.identityPublicHex
					}
				}
				if (Object.keys(payloads).length > 0) {
					this.sendMessage(await this.encryptServerMessage({
						a: 'w',
						p: payloads,
					}, this.serverShared))
				}
			} catch (error) {
				this.logEvent('onMessage-list', error, 'error')
			}
			if (this.callbacks.onClientList) {
				let clients = [];
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
							clients.push({
								clientId: clientId,
								username: this.channel[clientId].username,
								publicKey: this.channel[clientId].publicKey,
								fingerprint: this.channel[clientId].fingerprint
							})
					}
				}
				try {
					this.callbacks.onClientList(clients, null, {
						publicKey: this.identityPublicHex,
						fingerprint: this.identityFingerprint
					})
				} catch (error) {
					this.logEvent('onMessage-client-list-callback', error, 'error')
				}
			}
			return
		}
		if (!this.isString(serverDecrypted.p) || !this.isString(serverDecrypted.c)) {
			return
		}
		if (serverDecrypted.a === 'c' && (!this.channel[serverDecrypted.c] || !this.channel[serverDecrypted.c].shared)) {
			try {
				if (!this.channel[serverDecrypted.c]) {
					this.channel[serverDecrypted.c] = {
						username: null,
						keys: this.identityKeys,
						publicKey: '',
						fingerprint: '',
						shared: null,
					};
					this.sendMessage(await this.encryptServerMessage({
						a: 'c',
						p: this.identityPublicHex,
						c: serverDecrypted.c
					}, this.serverShared))
				}
				const peerMeta = this.getKeyMeta(serverDecrypted.p);
				this.channel[serverDecrypted.c].publicKey = peerMeta.publicKey;
				this.channel[serverDecrypted.c].fingerprint = peerMeta.fingerprint;
				const ecdhSecret = this.channel[serverDecrypted.c].keys.derive(this.clientEc.keyFromPublic(serverDecrypted.p, 'hex').getPublic()).toArrayLike(Buffer, 'be', 32);
				const peerKey = await this.derivePeerSharedKey(new Uint8Array(ecdhSecret), this.credentials.passwordKey, this.credentials.channel);
				if (!peerKey) {
					return
				}
				this.channel[serverDecrypted.c].shared = Buffer.from(peerKey);
				this.sendMessage(await this.encryptServerMessage({
					a: 'c',
					p: await this.encryptClientMessage({
						a: 'u',
						p: this.credentials.username
					}, this.channel[serverDecrypted.c].shared),
					c: serverDecrypted.c
				}, this.serverShared))
			} catch (error) {
				this.logEvent('onMessage-client', error, 'error')
			}
			return
		}
		if (serverDecrypted.a === 'c' && this.channel[serverDecrypted.c] && this.channel[serverDecrypted.c].shared) {
			const clientDecrypted = await this.decryptClientMessage(serverDecrypted.p, this.channel[serverDecrypted.c].shared);
			this.logEvent('onMessage-client-decrypted', clientDecrypted);
			if (!this.isObject(clientDecrypted) || !this.isString(clientDecrypted.a)) {
				return
			}
			if (clientDecrypted.a === 'u' && this.isString(clientDecrypted.p) && clientDecrypted.p.match(/\S+/) && !this.channel[serverDecrypted.c].username) {
				this.channel[serverDecrypted.c].username = clientDecrypted.p.replace(/^\s+/, '').replace(/\s+$/, '');
				if (this.callbacks.onClientSecured) {
					try {
						this.callbacks.onClientSecured({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							publicKey: this.channel[serverDecrypted.c].publicKey,
							fingerprint: this.channel[serverDecrypted.c].fingerprint
						})
					} catch (error) {
						this.logEvent('onMessage-client-secured-callback', error, 'error')
					}
				}
				return
			}			if (!this.channel[serverDecrypted.c].username) {
				return
			}
			if (clientDecrypted.a === 'm' && this.isString(clientDecrypted.t) && (this.isString(clientDecrypted.d) || this.isObject(clientDecrypted.d))) {
				if (this.callbacks.onClientMessage) {
					try {
						this.callbacks.onClientMessage({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							type: clientDecrypted.t,
							data: clientDecrypted.d
						})
					} catch (error) {
						this.logEvent('onMessage-client-message-callback', error, 'error')
					}
				}
				return
			}
		}
	}

	async processServerHandshakePacket(rawMessage) {
		const parts = rawMessage.split('|');
		if (!parts[0] || !parts[1]) {
			return
		}
		if (!this.config.rsaPublic) {
			this.pendingServerHandshakePacket = rawMessage;
			return
		}
		try {
			if (await crypto.subtle.verify({
					name: 'RSA-PSS',
					saltLength: 32
				}, await crypto.subtle.importKey('spki', Buffer.from(this.config.rsaPublic, 'base64'), {
					name: 'RSA-PSS',
					hash: {
						name: 'SHA-256'
					}
				}, false, ['verify']), Buffer.from(parts[1], 'base64'), Buffer.from(parts[0], 'hex')) === true) {
				const sharedBits = await crypto.subtle.deriveBits({
					name: 'ECDH',
					namedCurve: 'P-384',
					public: await crypto.subtle.importKey('raw', Buffer.from(parts[0], 'hex'), {
						name: 'ECDH',
						namedCurve: 'P-384'
					}, true, [])
				}, this.serverKeys.privateKey, 384);
				const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);
				const serverShared = await crypto.subtle.deriveBits({
					name: 'HKDF',
					hash: 'SHA-256',
					salt: new Uint8Array(0),
					info: new TextEncoder().encode('nodecrypt-server-handshake-v2')
				}, hkdfKey, 256);
				this.serverShared = Buffer.from(new Uint8Array(serverShared));
				this.sendMessage(await this.encryptServerMessage({
					a: 'j',
					p: this.credentials.channel
				}, this.serverShared));
				if (this.callbacks.onServerSecured) {
					try {
						this.callbacks.onServerSecured()
					} catch (error) {
						this.logEvent('onMessage-server-secured-callback', error, 'error')
					}
				}
			}
		} catch (error) {
			this.logEvent('processServerHandshakePacket', error, 'error')
		}
	}

	// WebSocket error event handler
	// WebSocket 错误事件处理
	async onError(event) {
		this.logEvent('onError', event, 'error');
		this.disconnect();
		if (this.credentials && !this.trustRejected) {
			this.startReconnect()
		}
		if (this.callbacks.onServerClosed) {
			try {
				this.callbacks.onServerClosed()
			} catch (error) {
				this.logEvent('onError-server-closed-callback', error, 'error')
			}
		}
	}

	// WebSocket close event handler
	// WebSocket 关闭事件处理
	async onClose(event) {
		this.logEvent('onClose', event);
		this.disconnect();
		if (this.credentials && !this.trustRejected) {
			this.startReconnect()
		}
		if (this.callbacks.onServerClosed) {
			try {
				this.callbacks.onServerClosed()
			} catch (error) {
				this.logEvent('onClose-server-closed-callback', error, 'error')
			}
		}
	}

	// Log events for debugging
	// 记录事件日志用于调试
	logEvent(source, message, level) {
		if (this.config.debug || (level && level.toLowerCase() === 'error')) {
			const date = new Date(),
				dateString = date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2) + ' ' + ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2) + ':' + ('0' + date.getSeconds()).slice(-2);
			console.log('[' + dateString + ']', (level ? level.toUpperCase() : 'INFO'), source + (message ? ':' : ''), (message ? message : ''))
		}
	}

	// Check if connection is open
	// 检查连接是否已打开
	isOpen() {
		return (this.connection && this.connection.readyState && this.connection.readyState === WebSocket.OPEN ? true : false)
	}

	// Check if connection is closed
	// 检查连接是否已关闭
	isClosed() {
		return (!this.connection || !this.connection.readyState || this.connection.readyState === WebSocket.CLOSED ? true : false)
	}

	// Start reconnect timer
	// 启动重连定时器
	startReconnect() {
		this.stopReconnect();
		this.logEvent('startReconnect');
		this.reconnect = setTimeout(() => {
			this.reconnect = null;
			this.connect()
		}, this.config.reconnectDelay)
	}

	// Stop reconnect timer
	// 停止重连定时器
	stopReconnect() {
		if (this.reconnect) {
			this.logEvent('stopReconnect');
			clearTimeout(this.reconnect);
			this.reconnect = null
		}
	}

	// Start ping timer
	// 启动心跳定时器
	startPing() {
		this.stopPing();
		this.logEvent('startPing');
		this.ping = setInterval(() => {
			const now = Date.now();
			if (!this.isOpen()) {
				return
			}
			if (this.lastOutboundAt && (now - this.lastOutboundAt) < (this.config.pingInterval - 1000)) {
				return
			}
			this.sendMessage('ping')
		}, this.config.pingInterval)
	}

	// Stop ping timer
	// 停止心跳定时器
	stopPing() {
		if (this.ping) {
			this.logEvent('stopPing');
			clearInterval(this.ping);
			this.ping = null
		}
	}

	// Disconnect from server
	// 从服务器断开连接
	disconnect() {
		this.stopReconnect();
		this.stopPing();
		if (!this.isClosed()) {
			try {
				this.logEvent('disconnect');
				this.connection.close()
			} catch (error) {
				this.logEvent('disconnect', error, 'error')
			}
		}
	}

	// Send a message to the server
	// 向服务器发送消息
	sendMessage(message) {
		try {
			if (this.isOpen()) {
				this.connection.send(message);
				this.lastOutboundAt = Date.now();
				return (true)
			}
		} catch (error) {
			this.logEvent('sendMessage', error, 'error')
		}
		return (false)
	}

	// Send a message to all channels
	// 向所有频道发送消息
	async sendChannelMessage(type, data) {
		if (this.serverShared) {
			try {
				let payloads = {};
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						payloads[clientId] = await this.encryptClientMessage({
							a: 'm',
							t: type,
							d: data
						}, this.channel[clientId].shared);
						if (payloads[clientId].length === 0) {
							return (false)
						}
					}
				}
				if (Object.keys(payloads).length > 0) {
					const payload = await this.encryptServerMessage({
						a: 'w',
						p: payloads,
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload);
					this.lastOutboundAt = Date.now();
				}
				return (true)
			} catch (error) {
				this.logEvent('sendChannelMessage', error, 'error')
			}
		}
		return (false)
	}

	// Encrypt a message for the server
	// 加密发送给服务器的消息
	async encryptServerMessage(message, key) {
		let encrypted = '';
		try {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const plainBytes = new TextEncoder().encode(JSON.stringify(message));
			const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'AES-GCM' }, false, ['encrypt']);
			const ciphertext = await crypto.subtle.encrypt({
				name: 'AES-GCM',
				iv: iv,
				additionalData: new TextEncoder().encode('nodecrypt-server-v1'),
				tagLength: 128
			}, cryptoKey, plainBytes);
			encrypted = Buffer.from(iv).toString('base64') + '|' + Buffer.from(new Uint8Array(ciphertext)).toString('base64')
		} catch (error) {
			this.logEvent('encryptServerMessage', error, 'error')
		}
		return (encrypted)
	}

	// Decrypt a message from the server
	// 解密来自服务器的消息
	async decryptServerMessage(message, key) {
		let decrypted = {};
		try {
			const parts = message.split('|');
			if (parts.length !== 2) {
				return decrypted
			}
			const iv = Buffer.from(parts[0], 'base64');
			const cipherBytes = Buffer.from(parts[1], 'base64');
			const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'AES-GCM' }, false, ['decrypt']);
			const plainBuffer = await crypto.subtle.decrypt({
				name: 'AES-GCM',
				iv: iv,
				additionalData: new TextEncoder().encode('nodecrypt-server-v1'),
				tagLength: 128
			}, cryptoKey, cipherBytes);
			decrypted = JSON.parse(new TextDecoder().decode(plainBuffer))
		} catch (error) {
			this.logEvent('decryptServerMessage', error, 'error')
		}
		return (decrypted)
	}

	// Encrypt a message for a client
	// 加密发送给客户端的消息
	async encryptClientMessage(message, key) {
		let encrypted = '';
		try {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const plainBytes = new TextEncoder().encode(JSON.stringify(message));
			const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'AES-GCM' }, false, ['encrypt']);
			const ciphertext = await crypto.subtle.encrypt({
				name: 'AES-GCM',
				iv: iv,
				additionalData: new TextEncoder().encode('nodecrypt-client-v1'),
				tagLength: 128
			}, cryptoKey, plainBytes);
			encrypted = Buffer.from(iv).toString('base64') + '|' + Buffer.from(new Uint8Array(ciphertext)).toString('base64')
		} catch (error) {
			this.logEvent('encryptClientMessage', error, 'error')
		}
		return (encrypted)
	}

	// Decrypt a message from a client
	// 解密来自客户端的消息
	async decryptClientMessage(message, key) {
		let decrypted = {};
		try {
			const parts = message.split('|');
			if (parts.length !== 2) {
				return decrypted
			}
			const iv = Buffer.from(parts[0], 'base64');
			const cipherBytes = Buffer.from(parts[1], 'base64');
			const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'AES-GCM' }, false, ['decrypt']);
			const plainBuffer = await crypto.subtle.decrypt({
				name: 'AES-GCM',
				iv: iv,
				additionalData: new TextEncoder().encode('nodecrypt-client-v1'),
				tagLength: 128
			}, cryptoKey, cipherBytes);
			decrypted = JSON.parse(new TextDecoder().decode(plainBuffer))
		} catch (error) {
			this.logEvent('decryptClientMessage', error, 'error')
		}
		return (decrypted)
	}

	// Check if value is a string
	// 检查值是否为字符串
	isString(value) {
		return (value && Object.prototype.toString.call(value) === '[object String]' ? true : false)
	}

	// Check if value is an array
	// 检查值是否为数组
	isArray(value) {
		return (value && Object.prototype.toString.call(value) === '[object Array]' ? true : false)
	}

	// Check if value is an object
	// 检查值是否为对象
	isObject(value) {
		return (value && Object.prototype.toString.call(value) === '[object Object]' ? true : false)
	}

	// Handle server public key
	// 处理服务器公钥
	async handleServerKey(serverKey, serverSignature) {
		this.logEvent('handleServerKey', 'Received server key');
		if (!this.serverMasterKey) {
			this.logEvent('handleServerKey', 'Missing trusted master key', 'error');
			return false
		}
		if (!serverSignature || !this.isString(serverSignature)) {
			this.logEvent('handleServerKey', 'Missing session key signature', 'error');
			return false
		}
		try {
			const masterKey = await crypto.subtle.importKey('spki', Buffer.from(this.serverMasterKey, 'base64'), {
				name: 'RSA-PSS',
				hash: {
					name: 'SHA-256'
				}
			}, false, ['verify']);
			const valid = await crypto.subtle.verify({
				name: 'RSA-PSS',
				saltLength: 32
			}, masterKey, Buffer.from(serverSignature, 'base64'), Buffer.from(serverKey, 'base64'));
			if (!valid) {
				this.logEvent('handleServerKey', 'Invalid session key signature', 'error');
				return false
			}
		} catch (error) {
			this.logEvent('handleServerKey', error, 'error');
			return false
		}
		this.config.rsaPublic = serverKey;
		return true
	}

	async handleMasterKey(payload) {
		if (!payload || !this.isString(payload.key)) {
			return false
		}
		const domain = this.getDomainTrustKey();
		const keyHex = payload.keyHex || Buffer.from(payload.key, 'base64').toString('hex');
		const keyFingerprint = await this.getMasterKeyFingerprint(payload.key);
		const store = this.getDomainTrustStore();
		const trusted = store[domain];
		let accepted = false;

		const url = new URL(window.location.href);
		const urlMasterKey = url.searchParams.get('mk');
		const trustedHash = keyFingerprint.hash;
		if (urlMasterKey && trustedHash && urlMasterKey === trustedHash) {
			accepted = true
		}

		if (!trusted) {
			if (!accepted) {
				accepted = await this.createSecurityModal({
					title: t('security.verify_master_title'),
					message: t('security.verify_master_message').replace('{domain}', domain),
					details: keyFingerprint.display || keyHex,
					confirmText: t('security.trust_key'),
					cancelText: t('security.do_not_trust'),
					danger: true
				})
			}
			if (!accepted) {
				await this.createSecurityModal({
					title: t('security.connection_blocked_title'),
					message: t('security.connection_blocked_untrusted'),
					confirmText: t('action.back'),
					showCancel: false,
					danger: true
				});
				return false
			}
			store[domain] = keyHex;
			this.saveDomainTrustStore(store);
		} else if (trusted.toLowerCase() !== keyHex.toLowerCase()) {
			const trustedFingerprint = await this.getMasterKeyFingerprint(Buffer.from(trusted, 'hex').toString('base64'));
			const replace = await this.createSecurityModal({
				title: t('security.master_changed_title'),
				message: t('security.master_changed_message').replace('{domain}', domain),
				details: `${t('security.fingerprint_old')}:\n${trustedFingerprint.display || trusted}\n\n${t('security.fingerprint_new')}:\n${keyFingerprint.display || keyHex}`,
				confirmText: t('security.replace_trusted_key'),
				cancelText: t('security.keep_old_key'),
				danger: true
			});
			if (!replace) {
				await this.createSecurityModal({
					title: t('security.connection_blocked_title'),
					message: t('security.connection_blocked_mismatch'),
					confirmText: t('action.back'),
					showCancel: false,
					danger: true
				});
				return false
			}
			store[domain] = keyHex;
			this.saveDomainTrustStore(store);
		}

		this.serverMasterKey = payload.key;
		if (keyFingerprint.hash) {
			url.searchParams.set('mk', keyFingerprint.hash);
		}
		window.history.replaceState({}, '', url.toString());
		return true
	}
};

if (typeof window !== 'undefined') {
	window.NodeCrypt = NodeCrypt
}