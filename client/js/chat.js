// Import necessary modules
// 导入必要的模块
import {
	createAvatarSVG
} from './util.avatar.js';
import {
	roomsData,
	activeRoomIndex,
	togglePrivateChat
} from './room.js';
import {
	escapeHTML,
	textToHTML
} from './util.string.js';
import {
	$,
	$id,
	createElement,
	on,
	off,
	addClass,
	removeClass
} from './util.dom.js';
import {
	getFileDisplayInfo,
	cancelFileDownload
} from './util.file.js';
import {
	t
} from './util.i18n.js';
import { getSetting } from './util.settings.js';
import DOMPurify from 'dompurify';
import Plyr from 'plyr';
import { PLYR_CONFIG } from './util.plyr.js';
import { ICONS } from './util.icons.js';

const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const canUseYouTubeEmbed = typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol);

function renderYouTubePreview(text = '') {
	if (!getSetting('youtubePreviews')) return '';
	const match = text.match(youtubeRegex);
	if (!match) return '';

	if (!canUseYouTubeEmbed) {
		return ``;
	}

	return `<div class="youtube-preview"><div class="js-plyr" data-plyr-provider="youtube" data-plyr-embed-id="${match[1]}"></div></div>`;
}

function initImagePreviews(root = document) {
	if (!root || !root.querySelectorAll) return;
	root.querySelectorAll('.bubble-content img.bubble-img').forEach((img) => {
		if (img.dataset.previewBound === '1') return;
		const hidePreview = () => {
			img.remove();
		};
		img.addEventListener('error', hidePreview, { once: true });
		if (img.complete && img.naturalWidth === 0) {
			hidePreview();
		}
		img.dataset.previewBound = '1';
	});
}

const plyrInitializedElements = new WeakSet();

function initPlyrPlayers(root = document) {
	if (!root || !root.querySelectorAll) return;
	root.querySelectorAll('.js-plyr').forEach((el) => {
		if (plyrInitializedElements.has(el) || el.dataset.plyrBound === '1' || el.plyr || el.closest('.plyr')) return;
		plyrInitializedElements.add(el);
		el.dataset.plyrBound = '1';
		try {
			new Plyr(el, PLYR_CONFIG);
		} catch (error) {
			plyrInitializedElements.delete(el);
			delete el.dataset.plyrBound;
			console.warn('Plyr initialization failed:', error);
			return;
		}
	});
}

function initAudioWaveforms(root = document) {
	if (!root || !root.querySelectorAll) return;
	root.querySelectorAll('.file-waveform').forEach((wave) => {
		if (wave.dataset.waveBound === '1') return;
		const fileMessage = wave.closest('.file-message');
		const audio = fileMessage?.querySelector('audio');
		if (!audio) return;
		const fileId = fileMessage.dataset.fileId;
		const transfer = window.fileTransfers?.get(fileId);
		wave.dataset.waveBound = '1';
		const barCount = Math.max(24, Math.floor(wave.clientWidth / 5));
		wave.innerHTML = Array.from({ length: barCount }, () => '<span class="file-wave-bar"></span>').join('');
		const bars = Array.from(wave.querySelectorAll('.file-wave-bar'));
		const source = transfer?.blob || transfer?.sourceFile;
		if (source) {
			void source.arrayBuffer().then((buffer) => {
				const AudioContextClass = window.AudioContext || window.webkitAudioContext;
				if (!AudioContextClass || !wave.isConnected) return;
				const context = new AudioContextClass();
				return context.decodeAudioData(buffer).then((decoded) => {
					if (!wave.isConnected) return;
					const samplesPerBar = Math.max(1, Math.floor(decoded.length / bars.length));
					const channelCount = decoded.numberOfChannels;
					const peaks = [];
					let maxPeak = 0;
					bars.forEach((bar, index) => {
						const start = index * samplesPerBar;
						const end = Math.min(decoded.length, start + samplesPerBar);
						let peak = 0;
						for (let channel = 0; channel < channelCount; channel++) {
							const samples = decoded.getChannelData(channel);
							for (let sample = start; sample < end; sample++) peak = Math.max(peak, Math.abs(samples[sample]));
						}
						peaks.push(peak);
						maxPeak = Math.max(maxPeak, peak);
					});
					bars.forEach((bar, index) => {
						const relativePeak = maxPeak ? peaks[index] / maxPeak : 0;
						bar.style.height = `${Math.max(8, Math.round(Math.sqrt(relativePeak) * 100))}%`;
					});
				}).catch((error) => console.warn('Audio waveform decode failed:', error)).finally(() => context.close());
			}).catch((error) => console.warn('Audio waveform read failed:', error));
		}
		const updateWaveProgress = () => {
			const progress = audio.duration ? (audio.currentTime / audio.duration) : 0;
			bars.forEach((bar, idx) => {
				const barProgress = (idx + 1) / bars.length;
				bar.classList.toggle('active', barProgress <= progress);
			});
		};
		audio.addEventListener('timeupdate', updateWaveProgress);
		wave.addEventListener('click', (event) => {
			if (!audio.duration) return;
			const rect = wave.getBoundingClientRect();
			if (!rect.width) return;
			const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
			audio.currentTime = ratio * audio.duration;
			updateWaveProgress();
		});
		updateWaveProgress();
	});
}

// Render the chat area
// 渲染聊天区域
export function renderChatArea() {
	const chatArea = $id('chat-area');
	if (!chatArea) return;
	if (activeRoomIndex < 0 || !roomsData[activeRoomIndex]) {
		chatArea.innerHTML = '';
		return
	}
	chatArea.innerHTML = '';
	roomsData[activeRoomIndex].messages.forEach(m => {
		if (m.type === 'me') addMsg(m.text, true, m.msgType || 'text', m.timestamp);
		else if (m.type === 'system') addSystemMsg(m.text, true, m.timestamp);
		else addOtherMsg(m.text, m.userName, m.avatar, true, m.msgType || 'text', m.timestamp, m.clientId || null, m.userColor, m.securityMeta || null)
	});
}

function formatMessageTime(ts) {
	const date = new Date(ts);
	return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function sanitizeImageSrc(value) {
	return escapeHTML(value).replace(/javascript:/gi, '');
}

function renderImageMessageContent(payload) {
	if (typeof payload === 'object' && payload && Array.isArray(payload.images)) {
		const messageText = payload.text ? textToHTML(payload.text) : '';
		const imageElements = payload.images
			.map((imgData) => `<img src="${sanitizeImageSrc(imgData)}" alt="image" class="bubble-img">`)
			.join('');
		if (messageText && imageElements) {
			return `<div class="mixed-content"><div class="message-text">${messageText}</div>${imageElements}</div>`;
		}
		return imageElements || messageText;
	}
	if (typeof payload === 'object' && payload && payload.image) {
		const imageHtml = `<img src="${sanitizeImageSrc(payload.image)}" alt="image" class="bubble-img">`;
		const messageText = payload.text ? textToHTML(payload.text) : '';
		return messageText ? `<div class="mixed-content"><div class="message-text">${messageText}</div>${imageHtml}</div>` : imageHtml;
	}
	return `<img src="${sanitizeImageSrc(payload)}" alt="image" class="bubble-img">`;
}

function renderMessageContent(payload, msgType, isSender) {
	if (msgType === 'image' || msgType === 'image_private') return renderImageMessageContent(payload);
	if (msgType === 'file' || msgType === 'file_private') return renderFileMessage(payload, isSender);
	return textToHTML(payload) + renderYouTubePreview(typeof payload === 'string' ? payload : '');
}

function renderSecurityIndicator(securityMeta = null) {
	if (!securityMeta || typeof securityMeta !== 'object') return '';
	if (securityMeta.status === 'missing_timestamp') {
		return `<span class="bubble-security-indicator missing" title="${escapeHTML(securityMeta.hint || '')}" aria-label="missing timestamp"></span>`;
	}
	if (securityMeta.status === 'replay_detected') {
		return `<span class="bubble-security-indicator replay" title="${escapeHTML(securityMeta.hint || '')}" aria-label="replay warning">!</span>`;
	}
	if (securityMeta.status === 'expired_timestamp') {
		return `<span class="bubble-security-indicator expired" title="${escapeHTML(securityMeta.hint || '')}" aria-label="expired timestamp"></span>`;
	}
	return '';
}

// Add a message to the chat area
// 添加消息到聊天区域
export function addMsg(text, isHistory = false, msgType = 'text', timestamp = null, targetRoomIndex = activeRoomIndex) {
	let ts = isHistory ? timestamp : (timestamp || Date.now());
	if (!ts) return;
	if (!isHistory && targetRoomIndex >= 0 && roomsData[targetRoomIndex]) {
		roomsData[targetRoomIndex].messages.push({
			type: 'me',
			text,
			msgType,
			timestamp: ts
		})
	}
	if (targetRoomIndex !== activeRoomIndex) return;
	const chatArea = $id('chat-area');
	if (!chatArea) return;
	let className = 'bubble me' + (msgType.includes('_private') ? ' private-message' : '');
	if (msgType === 'file' || msgType === 'file_private') className += ' file-bubble';
	const time = formatMessageTime(ts);
	const contentHtml = renderMessageContent(text, msgType, true);
	const div = createElement('div', {
		class: className
	}, `<span class="bubble-content">${contentHtml}</span><span class="bubble-meta">${time}</span>`);
	chatArea.appendChild(div);
	initImagePreviews(div);
	if ((msgType === 'file' || msgType === 'file_private') && text?.fileId) updateFileMessagePreview(text.fileId);
	initPlyrPlayers(div);
	initAudioWaveforms(div);
	chatArea.scrollTop = chatArea.scrollHeight
}

// Add a message from another user to the chat area
// 添加来自其他用户的消息到聊天区域
export function addOtherMsg(msg, userName = '', avatar = '', isHistory = false, msgType = 'text', timestamp = null, clientId = null, userColor = null, securityMeta = null) {
	if (!userName && activeRoomIndex >= 0) {
		const rd = roomsData[activeRoomIndex];
		// 优先使用文件消息自带的 userName 字段
		if (msg && msg.userName) {
			userName = msg.userName;
		} else if (rd && msg && msg.clientId && rd.userMap[msg.clientId]) {
			userName = rd.userMap[msg.clientId].userName || rd.userMap[msg.clientId].username || rd.userMap[msg.clientId].name || t('ui.anonymous')
		}
	}
	userName = userName || t('ui.anonymous');
	let ts = isHistory ? timestamp : (timestamp || Date.now());
	if (!ts) return;
	const chatArea = $id('chat-area');
	if (!chatArea) return;
	const bubbleWrap = createElement('div', { class: 'bubble-other-wrap' });
	const contentHtml = renderMessageContent(msg, msgType, false);
	const safeUserName = escapeHTML(userName);
	if (clientId && typeof clientId === 'string') {
		bubbleWrap.dataset.clientId = clientId;
	}
	bubbleWrap.dataset.userName = userName;
	const time = formatMessageTime(ts);
	const securityHtml = renderSecurityIndicator(securityMeta);
	let bubbleClasses = 'bubble other';
	if (msgType && msgType.includes('_private')) {
		bubbleClasses += ' private-message'
	}
	if (msgType === 'file' || msgType === 'file_private') {
		bubbleClasses += ' file-bubble';
	}
	bubbleWrap.innerHTML = `<span class="avatar"></span><div class="bubble-other-main"><div class="${bubbleClasses}"><div class="bubble-other-name-row"><div class="bubble-other-name">${safeUserName}</div>${securityHtml}</div><span class="bubble-content">${contentHtml}</span><span class="bubble-meta">${time}</span></div></div>`;
	let avatarSeed = avatar;
	let fingerprint = '';
	if (!avatarSeed && activeRoomIndex >= 0 && clientId) {
		const member = roomsData[activeRoomIndex] && roomsData[activeRoomIndex].userMap ? roomsData[activeRoomIndex].userMap[clientId] : null;
		if (member) {
			fingerprint = member.fingerprint;
			avatarSeed = member.fingerprint;
			userColor = member.userColor;
		}
	}
	const svg = createAvatarSVG(avatarSeed);
	const avatarEl = $('.avatar', bubbleWrap);
	if (avatarEl) {
		const cleanSvg = svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
		avatarEl.innerHTML = cleanSvg;
		avatarEl.title = fingerprint;
	}
	const nameEl = $('.bubble-other-name', bubbleWrap);
	if (nameEl && userColor) {
		nameEl.style.color = userColor;
	}
	chatArea.appendChild(bubbleWrap);
	initImagePreviews(bubbleWrap);
	if ((msgType === 'file' || msgType === 'file_private') && msg?.fileId) updateFileMessagePreview(msg.fileId);
	initPlyrPlayers(bubbleWrap);
	initAudioWaveforms(bubbleWrap);
	chatArea.scrollTop = chatArea.scrollHeight
}

// Add a system message to the chat area
// 添加系统消息到聊天区域
export function addSystemMsg(text, isHistory = false, timestamp = null) {
	if (!isHistory && activeRoomIndex >= 0) {
		const ts = timestamp || Date.now();
		roomsData[activeRoomIndex].messages.push({
			type: 'system',
			text,
			timestamp: ts
		})
	}
	const chatArea = $id('chat-area');
	if (!chatArea) return;
	const safeText = textToHTML(text);
	const div = createElement('div', {
		class: 'bubble system'
	}, `<span class="bubble-content">${safeText}</span>`);
	chatArea.appendChild(div);
	chatArea.scrollTop = chatArea.scrollHeight
}

// Update the style of the chat input area
// 更新聊天输入区域的样式
export function updateChatInputStyle() {
	const rd = roomsData[activeRoomIndex];
	const chatInputArea = $('.chat-input-area');
	const placeholder = $('.input-field-placeholder');
	const inputMessageInput = $('.input-message-input');
	if (!chatInputArea || !placeholder || !inputMessageInput) return;	if (rd && rd.privateChatTargetId) {
		addClass(chatInputArea, 'private-mode');
		addClass(inputMessageInput, 'private-mode');
		placeholder.textContent = `${t('ui.private_message_to')} ${escapeHTML(rd.privateChatTargetName)}`
	} else {
		removeClass(chatInputArea, 'private-mode');
		removeClass(inputMessageInput, 'private-mode');
		placeholder.textContent = t('ui.message')
	}
	const html = inputMessageInput.innerHTML.replace(/<br\s*\/?>(\s*)?/gi, '').replace(/&nbsp;/g, '').replace(/\u200B/g, '').trim();
	placeholder.style.opacity = (html === '') ? '1' : '0'
}

// Setup image preview functionality
// 设置图片预览功能
export function setupImagePreview() {
	on($id('chat-area'), 'click', function(e) {
		const target = e.target;
		const cancelDownloadBtn = target.closest('.file-cancel-download-btn');
		if (cancelDownloadBtn) {
			const fileId = cancelDownloadBtn.dataset.fileId || '';
			roomsData[activeRoomIndex]?.chat?.cancelFileReceive(fileId);
			cancelFileDownload(fileId);
			return;
		}
		const downloadBtn = target.closest('.file-download-btn');
		if (downloadBtn) {
			const fileId = downloadBtn.dataset.fileId || '';
			if (window.downloadFile && fileId) window.downloadFile(fileId);
			return;
		}
		const avatarEl = target.closest('.bubble-other-wrap .avatar');
		if (avatarEl) {
			const bubbleWrap = avatarEl.closest('.bubble-other-wrap');
			if (bubbleWrap && bubbleWrap.dataset && bubbleWrap.dataset.clientId) {
				togglePrivateChat(bubbleWrap.dataset.clientId, bubbleWrap.dataset.userName || t('ui.anonymous'));
			}
			return;
		}
		if (target.tagName === 'IMG' && target.closest('.bubble-content')) {
			showImageModal(target.src)
		}
	})
}

// Show the image modal
// 显示图片模态框
export function showImageModal(src) {
	const rawSrc = typeof src === 'string' ? src.trim() : '';
	if (!rawSrc) return;
	const normalizedSrc = rawSrc.toLowerCase();
	const allowedScheme = /^(blob:|data:image\/|https?:\/\/|\/)/.test(normalizedSrc);
	if (!allowedScheme) return;
	const modal = createElement('div', {
		class: 'img-modal-bg'
	}, `<div class="img-modal-blur"></div><div class="img-modal-content img-modal-content-overflow"><img class="img-modal-img"/><span class="img-modal-close">&times;</span></div>`);
	document.body.appendChild(modal);
	const img = $('img', modal);
	if (!img) return;
	img.src = rawSrc;
	on($('.img-modal-close', modal), 'click', () => modal.remove());
	on(modal, 'click', (e) => {
		if (e.target === modal) modal.remove()
	});
	let scale = 1;
	let isDragging = false;
	let lastX = 0,
		lastY = 0;
	let offsetX = 0,
		offsetY = 0;
	img.ondragstart = function(e) {
		e.preventDefault()
	};
	on(img, 'wheel', function(ev) {
		ev.preventDefault();
		const prevScale = scale;
		scale += ev.deltaY < 0 ? 0.1 : -0.1;
		scale = Math.max(0.2, Math.min(5, scale));
		if (scale === 1) {
			offsetX = 0;
			offsetY = 0
		}
		updateTransform()
	});

	function updateTransform() {
		img.style.transform = `translate(${offsetX}px,${offsetY}px)scale(${scale})`;
		img.style.cursor = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in'
	}
	on(img, 'mousedown', function(ev) {
		if (scale <= 1) return;
		isDragging = true;
		lastX = ev.clientX;
		lastY = ev.clientY;
		img.style.cursor = 'grabbing';
		document.body.style.userSelect = 'none'
	});

	function onMouseMove(ev) {
		if (!isDragging) return;
		offsetX += ev.clientX - lastX;
		offsetY += ev.clientY - lastY;
		lastX = ev.clientX;
		lastY = ev.clientY;
		updateTransform()
	}

	function onMouseUp() {
		if (isDragging) {
			isDragging = false;
			img.style.cursor = 'grab';
			document.body.style.userSelect = ''
		}
	}
	on(window, 'mousemove', onMouseMove);
	on(window, 'mouseup', onMouseUp);
	on(img, 'dblclick', function() {
		scale = 1;
		offsetX = 0;
		offsetY = 0;
		updateTransform()
	});
	const cleanup = () => {
		off(window, 'mousemove', onMouseMove);
		off(window, 'mouseup', onMouseUp);
		document.body.style.userSelect = ''
	};
	on(modal, 'remove', cleanup);
	on($('.img-modal-close', modal), 'click', cleanup);
	updateTransform()
}

// Render file message content
// 渲染文件消息内容
function renderFileMessage(fileData, isSender) {
	const {
		fileId,
		fileName,
		fileType = '',
		previewData = null,
		coverData = null,
		audioTitle = null,
		audioArtist = null,
		originalSize,
		totalVolumes
	} = fileData;
	const transfer = window.fileTransfers ? window.fileTransfers.get(fileId) : null;
	const effectivePreviewData = previewData || transfer?.previewUrl || null;
	const safeFileId = escapeHTML(typeof fileId === 'string' ? fileId : '');
	const { displayName, displayMeta, iconHtml } = getFileDisplayInfo({
		fileName,
		fileType,
		audioTitle,
		audioArtist,
		coverData,
		originalSize
	});
	
	const safeDisplayName = escapeHTML(displayName);
	const safePreviewSrc = effectivePreviewData ? escapeHTML(effectivePreviewData) : '';
	const mediaPreload = isSender && transfer?.sourceFile ? 'auto' : 'metadata';
	let previewHtml = '';
	if (safePreviewSrc && fileType.startsWith('image/')) {
		previewHtml = `<img src="${safePreviewSrc}" alt="image preview" class="bubble-img file-media-preview">`;
	} else if (safePreviewSrc && fileType.startsWith('audio/') && document.createElement('audio').canPlayType(fileType) !== '') {
		previewHtml = `<audio class="js-plyr file-media-preview" controls preload="${mediaPreload}"><source src="${safePreviewSrc}" type="${escapeHTML(fileType)}"></audio>`;
	} else if (safePreviewSrc && fileType.startsWith('video/') && document.createElement('video').canPlayType(fileType) !== '') {
		previewHtml = `<video class="js-plyr file-media-preview" controls preload="${mediaPreload}"><source src="${safePreviewSrc}" type="${escapeHTML(fileType)}"></video>`;
	}
	if (previewHtml) {
		previewHtml = DOMPurify.sanitize(previewHtml, {
			ALLOWED_TAGS: ['img', 'audio', 'video', 'source'],
			ALLOWED_ATTR: ['src', 'type', 'controls', 'preload', 'alt', 'class']
		});
	}

	// Check actual file transfer status
	let statusText = '';
	let progressWidth = '0%';
	let downloadBtnStyle = 'display: none;';
	let showProgress = false;
	
	if (transfer) {
		if (transfer.status === 'sending') {
			const progress = (transfer.sentVolumes / transfer.totalVolumes) * 100;
			progressWidth = `${progress}%`;
			statusText = `Uploading ${Math.floor(progress)}% (${transfer.sentVolumes}/${transfer.totalVolumes})`;
			showProgress = true;
			} else if (transfer.status === 'receiving') {
			const progress = (transfer.receivedVolumes.size / transfer.totalVolumes) * 100;
			progressWidth = `${progress}%`;
			statusText = `Receiving ${transfer.receivedVolumes.size}/${transfer.totalVolumes}`;
			showProgress = true;
			} else if (transfer.status === 'completed') {
			downloadBtnStyle = isSender ? 'display: none;' : 'display: flex;';
			} else if (transfer.status === 'cancelled') {
				statusText = t('file.download_stopped', 'Download stopped');
				showProgress = true;
		}	} else if (isSender) {
		// 发送方历史消息，不显示状态和下载按钮
		downloadBtnStyle = 'display: flex;';
	} else {
		// 接收方历史消息，直接显示下载按钮（带动画效果）
		downloadBtnStyle = 'display: flex;';
	}
	const waveformHtml = fileType.startsWith('audio/') ? '<div class="file-waveform"></div>' : '';
	const downloadIcon = ICONS.fileDownload;

	return `
		<div class="file-message" data-file-id="${safeFileId}">
			${previewHtml}
				<div class="file-main-content">
					<div class="file-info">
						<div class="file-icon">${iconHtml}</div>
						<div class="file-details">
							<div class="file-name" title="${safeDisplayName}">${safeDisplayName}</div>
							<div class="file-meta">${displayMeta}</div>
						</div>
					</div>
					<button class="file-download-btn show" style="${downloadBtnStyle}" data-file-id="${safeFileId}">
						${downloadIcon}
					</button>
				</div>
			${waveformHtml}
			${showProgress ? `<div class="file-progress-container">
				<div class="file-progress-bar">
					<div class="file-progress" style="width: ${progressWidth}"></div>
				</div>
				<div class="file-status-row">
					<div class="file-status">${statusText}</div>
					${transfer.status === 'receiving' ? `<button type="button" class="file-cancel-download-btn" data-file-id="${safeFileId}">${t('file.stop_download', 'Stop')}</button>` : ''}
				</div>
			</div>` : ''}
		</div>
	`;
}

export function updateFileMessagePreview(fileId) {
	if (typeof fileId !== 'string' || !/^file_[0-9]{10,20}_[a-z0-9]{6,32}$/.test(fileId)) return;
	const transfer = window.fileTransfers?.get(fileId);
	if (!transfer?.previewUrl) return;
	const fileMessage = document.querySelector(`.file-message[data-file-id="${fileId}"]`);
	if (!fileMessage) return;
	const existingMedia = fileMessage.querySelector('.bubble-img, audio, video');
	if (transfer.sourceFile && existingMedia) {
		if (existingMedia.tagName === 'IMG') {
			if (existingMedia.src !== transfer.previewUrl) existingMedia.src = transfer.previewUrl;
		} else {
			let source = existingMedia.querySelector('source');
			if (!source) {
				source = document.createElement('source');
				existingMedia.appendChild(source);
			}
			if (source.src !== transfer.previewUrl) source.src = transfer.previewUrl;
			source.type = transfer.fileType;
			existingMedia.preload = 'auto';
			if (existingMedia.readyState === 0) existingMedia.load();
		}
		existingMedia.classList.add('file-media-preview');
		initAudioWaveforms(fileMessage);
		return;
	}
	const existingSource = existingMedia?.tagName === 'IMG'
		? existingMedia.src
		: (existingMedia?.querySelector('source')?.src || existingMedia?.src || '');
	if (existingMedia && existingSource === transfer.previewUrl) {
		existingMedia.classList.add('file-media-preview');
		if (existingMedia.tagName !== 'IMG' && existingMedia.readyState === 0) existingMedia.load();
		initAudioWaveforms(fileMessage);
		return;
	}
	const oldPreview = fileMessage.querySelector('.file-media-preview');
	if (oldPreview) {
		const oldPlayer = oldPreview.closest('.plyr');
		if (oldPlayer) {
			oldPreview.plyr?.destroy();
			oldPlayer.remove();
		} else {
			oldPreview.remove();
		}
	}
	let preview;
	if (transfer.fileType.startsWith('image/')) {
		preview = document.createElement('img');
		preview.alt = 'image preview';
		preview.className = 'bubble-img file-media-preview';
		preview.src = transfer.previewUrl;
	} else if (transfer.fileType.startsWith('audio/')) {
		preview = document.createElement('audio');
		preview.className = 'js-plyr file-media-preview';
		preview.controls = true;
		preview.preload = 'metadata';
		const source = document.createElement('source');
		source.src = transfer.previewUrl;
		source.type = transfer.fileType;
		preview.appendChild(source);
	} else if (transfer.fileType.startsWith('video/')) {
		preview = document.createElement('video');
		preview.className = 'js-plyr file-media-preview';
		preview.controls = true;
		preview.preload = 'metadata';
		const source = document.createElement('source');
		source.src = transfer.previewUrl;
		source.type = transfer.fileType;
		preview.appendChild(source);
	}
	if (!preview) return;
	fileMessage.prepend(preview);
	initImagePreviews(fileMessage);
	initPlyrPlayers(fileMessage);
	initAudioWaveforms(fileMessage);
}

// Automatically adjust the height of the input area
// 自动调整输入区域的高度
export function autoGrowInput() {
	const input = $('.input-message-input');
	if (!input) return;
	input.style.height = 'auto';
	input.style.height = input.scrollHeight + 'px'
}

// Handle pasting text as plain text
// 处理粘贴为纯文本
function handlePasteAsPlainText(element) {
	if (!element) return;
	on(element, 'paste', function(e) {
		e.preventDefault();
		let text = '';
		if (e.clipboardData || window.clipboardData) {
			text = (e.clipboardData || window.clipboardData).getData('text/plain')
		}
		if (document.queryCommandSupported('insertText')) {
			document.execCommand('insertText', false, text)
		} else {
			const selection = window.getSelection();
			if (selection.rangeCount) {
				const range = selection.getRangeAt(0);
				range.deleteContents();
				const textNode = document.createTextNode(text);
				range.insertNode(textNode);
				range.setStartAfter(textNode);
				range.setEndAfter(textNode);
				selection.removeAllRanges();
				selection.addRange(range)
			}
		}
	})
}

// Setup input placeholder functionality
// 设置输入框占位符功能
export function setupInputPlaceholder() {
	const input = $('.input-message-input');
	const placeholder = $('.input-field-placeholder');
	if (!input || !placeholder) return;

	function checkEmpty() {
		const html = input.innerHTML.replace(/<br\s*\/?>(\s*)?/gi, '').replace(/&nbsp;/g, '').replace(/\u200B/g, '').trim();
		if (html === '') {
			placeholder.style.opacity = '1'
		} else {
			placeholder.style.opacity = '0'
		}
		autoGrowInput()
	}
	on(input, 'input', checkEmpty);
	on(input, 'blur', checkEmpty);
	on(input, 'focus', checkEmpty);
	handlePasteAsPlainText(input);
	checkEmpty();
	autoGrowInput();
	updateChatInputStyle()
}
