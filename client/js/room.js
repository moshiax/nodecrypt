// Room management logic for NodeCrypt web client
// NodeCrypt 网页客户端的房间管理逻辑

import {
	getColor,
	formatFingerprintColon,
	createAvatarSVG
} from './util.avatar.js';
import {
	sha256Hex
} from './util.crypto.js';
import {
	renderChatArea,
	addSystemMsg,
	updateChatInputStyle
} from './chat.js';
import {
	renderMainHeader,
	renderUserList,
	resetLoginButtons
} from './ui.js';
import {
	escapeHTML
} from './util.string.js';
import {
	$id,
	createElement
} from './util.dom.js';
import { t } from './util.i18n.js';
import { isValidFileId } from './util.file.js';
import { getSetting } from './util.settings.js';
let roomsData = [];
let activeRoomIndex = -1;

// Get a new room data object
// 获取一个新的房间数据对象
export function getNewRoomData() {
	return {
		roomName: '',
		userList: [],
		userMap: {},
		myId: null,
		myUserName: '',
		chat: null,
		messages: [],
		prevUserList: [],
		knownUserIds: new Set(),
		unreadCount: 0,
		privateChatTargetId: null,
		privateChatTargetName: null,
		localPublicKey: '',
		localFingerprint: '',
		localUserColor: '',
		roomFingerprint: '',
		serverInput: '',
		serverHost: '',
		wsProtocol: 'ws',
		replayMessageIds: new Map()
	}
}

function getTimestampWindowSec() {
	const configured = Number(getSetting('timestampWindowSec'));
	if (!Number.isFinite(configured)) return 10;
	return Math.max(1, Math.floor(configured));
}

function cleanupReplayCache(rd, nowMs = Date.now()) {
	if (!rd?.replayMessageIds) return;
	for (const [messageId, expiresAt] of rd.replayMessageIds.entries()) {
		if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
			rd.replayMessageIds.delete(messageId);
		}
	}
}

function buildMessageSecurityMeta(rd, messageId, timestampSec) {
	const nowMs = Date.now();
	const nowSec = Math.floor(nowMs / 1000);
	const timestampWindowSec = getTimestampWindowSec();
	cleanupReplayCache(rd, nowMs);
	let status = 'ok';
	let hint = '';
	let secondsAgo = 0;

	if ((nowSec - timestampSec) > timestampWindowSec) {
		status = 'expired_timestamp';
		secondsAgo = nowSec - timestampSec;
		hint = t('security.timestamp_expired').replace('{seconds}', String(secondsAgo));
	}

	if (rd.replayMessageIds.has(messageId)) {
		status = 'replay_detected';
		hint = t('security.replay_detected');
	} else {
		rd.replayMessageIds.set(messageId, nowMs + (timestampWindowSec * 2000));
	}

	return {
		status,
		hint,
		secondsAgo,
		messageId,
		timestampSec
	};
}

const TEXT_SECURITY_SUFFIX_REGEX = /(?:\r?\n)?\{([0-9]{10,20})-([a-z0-9]{6,32})\}\s*$/i;
const FILE_SECURITY_ID_REGEX = /^file_([0-9]{10,20})_([a-z0-9]{6,32})$/i;

function unwrapIncomingPayload(rd, msgType, rawData) {
	if (msgType && msgType.startsWith('file_')) {
		const fileId = rawData && typeof rawData === 'object' ? rawData.fileId : '';
		const match = (typeof fileId === 'string') ? fileId.match(FILE_SECURITY_ID_REGEX) : null;
		if (!match) {
			return {
				rejected: false,
				payload: rawData,
				securityMeta: {
					status: 'missing_timestamp',
					hint: t('security.no_timestamp'),
					secondsAgo: 0,
					messageId: '',
					timestampSec: null
				}
			};
		}
		let timestampSec = Number(match[1]);
		if (timestampSec > 9999999999) {
			timestampSec = Math.floor(timestampSec / 1000);
		}
		const messageId = String(match[2] || '').toLowerCase();
		return {
			payload: rawData,
			securityMeta: buildMessageSecurityMeta(rd, messageId, timestampSec),
			rejected: false
		};
	}

	if (typeof rawData === 'string') {
		const match = rawData.match(TEXT_SECURITY_SUFFIX_REGEX);
		if (!match) {
			return {
				rejected: false,
				payload: rawData,
				securityMeta: {
					status: 'missing_timestamp',
					hint: t('security.no_timestamp'),
					secondsAgo: 0,
					messageId: '',
					timestampSec: null
				}
			};
		}
		let timestampSec = Number(match[1]);
		if (timestampSec > 9999999999) {
			timestampSec = Math.floor(timestampSec / 1000);
		}
		const messageId = String(match[2] || '').toLowerCase();
		const cleanText = rawData.replace(TEXT_SECURITY_SUFFIX_REGEX, '').trimEnd();
		return {
			rejected: false,
			payload: cleanText,
			securityMeta: buildMessageSecurityMeta(rd, messageId, timestampSec)
		};
	}
	return {
		rejected: false,
		payload: rawData,
		securityMeta: {
			status: 'missing_timestamp',
			hint: t('security.no_timestamp'),
			secondsAgo: 0,
			messageId: '',
			timestampSec: null
		}
	};
}

function decorateUser(user) {
	if (!user || typeof user !== 'object') return user;
	const fingerprint = String(user.fingerprint);
	user.userColor = getColor(fingerprint);
	return user;
}


async function refreshRoomFingerprint(rd) {
	if (!rd) return;
	const allFingerprints = [];
	if (rd.localFingerprint) allFingerprints.push(String(rd.localFingerprint));
	for (const user of (rd.userList || [])) {
		if (user && user.fingerprint) allFingerprints.push(String(user.fingerprint));
	}
	const sorted = allFingerprints.sort((a, b) => a.localeCompare(b));
	const digestInput = sorted.join('');
	if (!digestInput) {
		rd.roomFingerprint = '';
		return;
	}
	const roomHash = await sha256Hex(digestInput);
	rd.roomFingerprint = formatFingerprintColon(roomHash, 16);
}

// Switch to another room by index
// 切换到指定索引的房间
export function switchRoom(index) {
	if (index < 0 || index >= roomsData.length) return;
	activeRoomIndex = index;
	const rd = roomsData[index];
	if (typeof rd.unreadCount === 'number') rd.unreadCount = 0;
	renderRooms(index);
	renderMainHeader();
	renderUserList(false);
	renderChatArea();
	updateChatInputStyle()
}

// Render the room list
// 渲染房间列表
export function renderRooms(activeId = 0) {
	const roomList = $id('room-list');
	roomList.innerHTML = '';
	roomsData.forEach((rd, i) => {
		const div = createElement('div', {
			class: 'room' + (i === activeId ? ' active' : ''),
			onclick: () => switchRoom(i)
		});
		const safeRoomName = escapeHTML(rd.roomName);
		let unreadHtml = '';
		if (rd.unreadCount && i !== activeId) {
			unreadHtml = `<span class="room-unread-badge">${rd.unreadCount>99?'99+':rd.unreadCount}</span>`
		}
		const roomSeed = rd.roomFingerprint || rd.roomName;
		const safeRoomFingerprint = escapeHTML(rd.roomFingerprint || '');
		const roomSvg = createAvatarSVG(roomSeed).replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
		const safeServerHost = escapeHTML(rd.serverHost || '');
		const protoClass = rd.wsProtocol === 'wss' ? 'room-proto-secure' : 'room-proto-insecure';
		div.innerHTML = `<span class="avatar room-avatar" title="${safeRoomFingerprint}">${roomSvg}</span><div class="info"><div class="title">#${safeRoomName}</div><div class="room-server">${safeServerHost}</div><div class="room-proto ${protoClass}">${rd.wsProtocol}://</div></div>${unreadHtml}`;
		roomList.appendChild(div)
	})
}

// Join a room
// 加入一个房间
export async function joinRoom(userName, roomName, password, serverConfig, tokenMasterKey = '', modal = null, onResult) {
	const newRd = getNewRoomData();
	newRd.roomName = roomName;
	newRd.myUserName = userName;
	newRd.password = password;
	newRd.serverInput = serverConfig.serverInput;
	newRd.serverHost = serverConfig.displayHost;
	newRd.wsProtocol = serverConfig.wsProtocol;
	let closed = false;
	let activated = false;
	let idx = -1;
	let chatInst = null;
	const callbacks = {
		onServerClosed: () => {
			resetLoginButtons();
			if (onResult && !closed) {
				closed = true;
				onResult(false)
			}
		},		onServerSecured: () => {
			if (!activated) {
				roomsData.push(newRd);
				idx = roomsData.length - 1;
				activated = true;
				switchRoom(idx);
			}
			if (modal) modal.remove();
			else {
				const loginContainer = $id('login-container');
				if (loginContainer) loginContainer.style.display = 'none';
				const chatContainer = $id('chat-container');
				if (chatContainer) chatContainer.style.display = '';
				

			}
			if (onResult && !closed) {
				closed = true;
				onResult(true)
			}
				addSystemMsg(t('system.secured'))
			},
		onClientSecured: (user) => handleClientSecured(idx, user),
		onClientList: (list, selfId, localMeta) => handleClientList(idx, list, selfId, localMeta),
		onClientLeft: (clientId) => handleClientLeft(idx, clientId),
		onClientMessage: (msg) => handleClientMessage(idx, msg),
	};
	chatInst = new window.NodeCrypt({ ...window.config, wsAddress: serverConfig.wsAddress, domainKey: serverConfig.domainKey, tokenMasterKey }, callbacks);
	newRd.chat = chatInst;
	await chatInst.setCredentials(userName, roomName, password);
	chatInst.connect();
}

// Handle the client list update
// 处理客户端列表更新
export function handleClientList(idx, list, selfId, localMeta = null) {
	const rd = roomsData[idx];
	if (!rd) return;
	if (localMeta && typeof localMeta === 'object') {
		rd.localPublicKey = localMeta.publicKey;
		rd.localFingerprint = localMeta.fingerprint;
		rd.localUserColor = getColor(rd.localFingerprint);
	}
	const oldUserIds = new Set((rd.userList || []).map(u => u.clientId));
	const newUserIds = new Set(list.map(u => u.clientId));
	for (const oldId of oldUserIds) {
		if (!newUserIds.has(oldId)) {
			handleClientLeft(idx, oldId)
		}
	}
	rd.userList = list.map((user) => decorateUser(user));
	rd.userMap = {};
	rd.userList.forEach(u => {
		rd.userMap[u.clientId] = u
	});
	rd.myId = selfId;
	refreshRoomFingerprint(rd).then(() => {
		if (activeRoomIndex === idx) {
			renderMainHeader();
			renderRooms(activeRoomIndex);
		}
	});
	if (activeRoomIndex === idx) {
		renderUserList(false);
		renderMainHeader()
	}
	rd.initCount = (rd.initCount || 0) + 1;
	if (rd.initCount === 2) {
		rd.isInitialized = true;
		rd.knownUserIds = new Set(list.map(u => u.clientId))
	}
}

// Handle client secured event
// 处理客户端安全连接事件
export function handleClientSecured(idx, user) {
	const rd = roomsData[idx];
	if (!rd) return;
	decorateUser(user);
	rd.userMap[user.clientId] = user;
	const existingUserIndex = rd.userList.findIndex(u => u.clientId === user.clientId);
	if (existingUserIndex === -1) {
		rd.userList.push(user)
	} else {
		rd.userList[existingUserIndex] = user
	}
	refreshRoomFingerprint(rd).then(() => {
		if (activeRoomIndex === idx) {
			renderMainHeader();
			renderRooms(activeRoomIndex);
		}
	});
	if (activeRoomIndex === idx) {
		renderUserList(false);
		renderMainHeader()
	}
	if (!rd.isInitialized) {
		return
	}
	const isNew = !rd.knownUserIds.has(user.clientId);
	if (isNew) {
		rd.knownUserIds.add(user.clientId);		const name = user.userName || user.username || user.name || t('ui.anonymous');
		const msg = `${name} ${t('system.joined')}`;
		rd.messages.push({
			type: 'system',
			text: msg
		});
		if (activeRoomIndex === idx) addSystemMsg(msg, true);
		if (window.notifyMessage) {
			window.notifyMessage(rd.roomName, 'system', msg)
		}
	}
}

// Handle client left event
// 处理客户端离开事件
export function handleClientLeft(idx, clientId) {
	const rd = roomsData[idx];
	if (!rd) return;
	if (rd.privateChatTargetId === clientId) {
		rd.privateChatTargetId = null;
		rd.privateChatTargetName = null;
		if (activeRoomIndex === idx) {
			updateChatInputStyle()
		}
	}
	const user = rd.userMap[clientId];
	const name = user ? (user.userName || user.username || user.name || 'Anonymous') : 'Anonymous';
	const msg = `${name} ${t('system.left')}`;
	rd.messages.push({
		type: 'system',
		text: msg
	});
	if (activeRoomIndex === idx) addSystemMsg(msg, true);
	rd.userList = rd.userList.filter(u => u.clientId !== clientId);
	delete rd.userMap[clientId];
	refreshRoomFingerprint(rd).then(() => {
		if (activeRoomIndex === idx) {
			renderMainHeader();
			renderRooms(activeRoomIndex);
		}
	});
	if (activeRoomIndex === idx) {
		renderUserList(false);
		renderMainHeader()
	}
}

// Handle client message event
// 处理客户端消息事件
export function handleClientMessage(idx, msg) {
	const newRd = roomsData[idx];
	if (!newRd) return;
	const msgType = msg.type || 'text';
	const { payload, securityMeta, rejected } = unwrapIncomingPayload(newRd, msgType, msg.data);
	if (rejected) return;

	// Prevent processing own messages unless it's a private message sent to oneself
	if (msg.clientId === newRd.myId && msg.userName === newRd.myUserName && !msg.type.includes('_private')) {
		return;
	}

	let realUserName = msg.userName;
	if (!realUserName && msg.clientId && newRd.userMap[msg.clientId]) {
		realUserName = newRd.userMap[msg.clientId].userName || newRd.userMap[msg.clientId].username || newRd.userMap[msg.clientId].name;
	}

	// Handle file messages
	if (msgType.startsWith('file_')) {
		// Part 1: Update message history and send notifications (for 'file_start' type)
		if (msgType === 'file_start' || msgType === 'file_start_private') {
			const historyMsgType = msgType === 'file_start_private' ? 'file_private' : 'file';
			
			const fileId = payload && payload.fileId;
			if (isValidFileId(fileId)) {
				const messageAlreadyInHistory = newRd.messages.some(
					m => m.msgType === historyMsgType && m.text && m.text.fileId === fileId && m.userName === realUserName
				);

				if (!messageAlreadyInHistory) {
					newRd.messages.push({
						type: 'other',
						text: payload, // This is the file metadata object
						userName: realUserName,
						avatar: msg.clientId && newRd.userMap[msg.clientId] && newRd.userMap[msg.clientId].fingerprint,
						userColor: msg.clientId && newRd.userMap[msg.clientId] && newRd.userMap[msg.clientId].userColor,
						clientId: msg.clientId || null,
						msgType: historyMsgType,
						timestamp: (payload && payload.timestamp) || Date.now(),
						securityMeta
					});
				}
			} else if (fileId) {
				console.warn('Rejected file_start with unsafe fileId in history pipeline:', fileId);
			}

			const notificationMsgType = msgType.includes('_private') ? 'private file' : 'file';
			if (window.notifyMessage && payload && payload.fileName) {
				window.notifyMessage(newRd.roomName, notificationMsgType, `${payload.fileName}`, realUserName);
			}
		}

		// Part 2: Handle UI interaction (rendering in active room, or unread count in inactive room)
		if (activeRoomIndex === idx) {
			// If it's the active room, delegate to util.file.js to handle UI and file transfer state.
			// This applies to all file-related messages (file_start, file_volume, file_end, etc.)
			if (window.handleFileMessage) {
				window.handleFileMessage({
					...payload,
					securityMeta,
					clientId: msg.clientId || null,
					userName: realUserName,
					avatar: msg.clientId && newRd.userMap[msg.clientId] && newRd.userMap[msg.clientId].fingerprint,
					userColor: msg.clientId && newRd.userMap[msg.clientId] && newRd.userMap[msg.clientId].userColor
				}, msgType.includes('_private'));
			}
		} else {
			// If it's not the active room, only increment unread count for 'file_start' messages.
			if (msgType === 'file_start' || msgType === 'file_start_private') {
				newRd.unreadCount = (newRd.unreadCount || 0) + 1;
				renderRooms(activeRoomIndex);
			}
		}
		return; // File messages are fully handled.
	}

	// Add message to messages array for chat history
	roomsData[idx].messages.push({
		type: 'other',
		text: payload,
		userName: realUserName,
		avatar: msg.clientId && newRd.userMap[msg.clientId] && newRd.userMap[msg.clientId].fingerprint,
		userColor: msg.clientId && newRd.userMap[msg.clientId] && newRd.userMap[msg.clientId].userColor,
		clientId: msg.clientId || null,
		msgType: msgType,
		timestamp: Date.now(),
		securityMeta
	});

	// Only add message to chat display if it's for the active room
	if (activeRoomIndex === idx) {
		if (window.addOtherMsg) {
			window.addOtherMsg(payload, realUserName, msg.clientId && newRd.userMap[msg.clientId] && newRd.userMap[msg.clientId].fingerprint, false, msgType, null, msg.clientId || null, msg.clientId && newRd.userMap[msg.clientId] && newRd.userMap[msg.clientId].userColor, securityMeta);
		}
	} else {
		roomsData[idx].unreadCount = (roomsData[idx].unreadCount || 0) + 1;
		renderRooms(activeRoomIndex);
	}

	const notificationMsgType = msgType.includes('_private') ? `private ${msgType.split('_')[0]}` : msgType;
	if (window.notifyMessage) {
		window.notifyMessage(newRd.roomName, notificationMsgType, payload, realUserName);
	}
}

// Toggle private chat with a user
// 切换与某用户的私聊
export function togglePrivateChat(targetId, targetName) {
	const rd = roomsData[activeRoomIndex];
	if (!rd) return;
	if (rd.privateChatTargetId === targetId) {
		rd.privateChatTargetId = null;
		rd.privateChatTargetName = null
	} else {
		rd.privateChatTargetId = targetId;
		rd.privateChatTargetName = targetName
	}
	renderUserList();
	updateChatInputStyle()
}


// Exit the current room
// 退出当前房间
export function exitRoom() {
	if (activeRoomIndex >= 0 && roomsData[activeRoomIndex]) {
		const chatInst = roomsData[activeRoomIndex].chat;
		if (chatInst && typeof chatInst.destruct === 'function') {
			chatInst.destruct()
		} else if (chatInst && typeof chatInst.disconnect === 'function') {
			chatInst.disconnect()
		}
		roomsData[activeRoomIndex].chat = null;
		roomsData.splice(activeRoomIndex, 1);
		if (roomsData.length > 0) {
			switchRoom(0);
			return true
		} else {
			return false
		}
	}
	return false
}

export { roomsData, activeRoomIndex };
