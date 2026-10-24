// Import necessary modules
// 导入必要的模块
import { deflate, Inflate } from 'fflate';
import { sha256 } from '@noble/hashes/sha2';
import { sha256HexRaw } from './util.crypto.js';
import { parseBlob } from 'music-metadata';
import { showFileUploadModal, addFilesToUploadModal } from './util.fileUpload.js';
import { escapeHTML } from './util.string.js';
import { getSetting } from './util.settings.js';
import { t } from './util.i18n.js';

export function getFileDisplayInfo({
	fileName = '',
	fileType = '',
	audioTitle = null,
	audioArtist = null,
	coverData = null,
	originalSize = 0
} = {}) {
	const safeTitle = typeof audioTitle === 'string' ? audioTitle.trim() : '';
	const safeArtist = typeof audioArtist === 'string' ? audioArtist.trim() : '';
	let displayName = fileName;
	if (safeArtist && safeTitle) displayName = `${safeArtist} - ${safeTitle}`;
	else if (safeArtist && !safeTitle) displayName = `${safeArtist} - ${fileName}`;
	else if (!safeArtist && safeTitle) displayName = safeTitle;
	const safeCoverData = coverData ? escapeHTML(coverData) : '';
	const iconHtml = safeCoverData ? `<img src="${safeCoverData}" alt="cover" class="file-icon-cover">` : getFileEmoji(fileName, fileType);
	return {
		displayName,
		displayMeta: formatFileSize(originalSize),
		iconHtml
	};
}

// 分卷大小统一配置
const DEFAULT_VOLUME_SIZE = 256 * 1024;
const LARGE_FILE_THRESHOLD = 16 * 1024 * 1024;
const LARGE_FILE_CHUNK_SIZE = 256 * 1024;
const MAX_FILE_VOLUME_BYTES = LARGE_FILE_CHUNK_SIZE + 1024;
const FILE_ID_PATTERN = /^file_[0-9]{10,20}_[a-z0-9]{6,32}$/;

// File transfer state management
// 文件传输状态管理
window.fileTransfers = new Map();

// Base64 encoding for binary data (more efficient than hex)
// Base64编码用于二进制数据（比十六进制更高效）
function arrayBufferToBase64(buffer) {
	const uint8Array = new Uint8Array(buffer);
	let binary = '';
	const chunkSize = 0x8000; // 32KB chunks to avoid call stack limits
	
	for (let i = 0; i < uint8Array.length; i += chunkSize) {
		const chunk = uint8Array.subarray(i, i + chunkSize);
		binary += String.fromCharCode.apply(null, chunk);
	}
	
	return btoa(binary);
}

// Base64 decoding back to binary
// Base64解码回二进制数据
function base64ToArrayBuffer(base64) {
	const binary = atob(base64);
	const uint8Array = new Uint8Array(binary.length);
	
	for (let i = 0; i < binary.length; i++) {
		uint8Array[i] = binary.charCodeAt(i);
	}
	
	return uint8Array;
}

// Generate unique file ID
// 生成唯一文件ID
function generateFileId() {
	const timestampSec = Math.floor(Date.now() / 1000);
	const fileUuid = (window.crypto && typeof window.crypto.randomUUID === 'function')
		? window.crypto.randomUUID().replace(/-/g, '').toLowerCase().slice(0, 32)
		: Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
	return `file_${timestampSec}_${fileUuid}`;
}

export function isValidFileId(fileId) {
	return typeof fileId === 'string' && FILE_ID_PATTERN.test(fileId);
}

function escapeSelectorValue(value) {
	if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
		return CSS.escape(value);
	}
	return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Compress file into volumes with optimized compression
// 将文件压缩为分卷，优化压缩算法
async function compressFileToVolumes(file, volumeSize = DEFAULT_VOLUME_SIZE, onProgress = () => {}) {
	if (file.size > LARGE_FILE_THRESHOLD) {
		return prepareLargeFile(file, onProgress);
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = async function(e) {
			const arrayBuffer = new Uint8Array(e.target.result);
			
			try {
				// Calculate hash of original file for integrity
				const originalHash = sha256HexRaw(arrayBuffer);
				
				// Use single compression pass with balanced compression
				// 使用单次压缩，平衡压缩率和速度
				deflate(arrayBuffer, { 
					level: 6, // 平衡压缩级别
					mem: 8    // 合理内存使用
				}, (err, compressed) => {
					if (err) {
						reject(err);
						return;
					}
					
					// Split compressed data into volumes
					const volumes = [];
					for (let i = 0; i < compressed.length; i += volumeSize) {
						const volume = compressed.slice(i, i + volumeSize);
						volumes.push(arrayBufferToBase64(volume));
					}
					
					resolve({
						volumes,
						totalVolumes: volumes.length,
						compression: 'deflate',
						originalSize: file.size,
						compressedSize: compressed.length,
						originalHash
					});
				});
			} catch (hashError) {
				reject(hashError);
			}
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(file);
	});
}

async function prepareLargeFile(file, onProgress = () => {}) {
	const hash = sha256.create();
	const totalVolumes = Math.ceil(file.size / LARGE_FILE_CHUNK_SIZE);
	for (let offset = 0; offset < file.size; offset += LARGE_FILE_CHUNK_SIZE) {
		const chunk = new Uint8Array(await file.slice(offset, offset + LARGE_FILE_CHUNK_SIZE).arrayBuffer());
		hash.update(chunk);
		onProgress(Math.min(offset + chunk.length, file.size), file.size);
	}
	const originalHash = sha256HexRaw(hash.digest());
	return {
		volumes: null,
		file,
		compression: 'chunked-raw',
		totalVolumes,
		originalSize: file.size,
		compressedSize: file.size,
		originalHash
	};
}

function inflateWithLimit(compressed, expectedSize) {
	const chunks = [];
	let outputSize = 0;
	const inflater = new Inflate((chunk) => {
		outputSize += chunk.length;
		if (outputSize > expectedSize) throw new Error('Decompressed file exceeds declared size');
		chunks.push(chunk);
	});
	inflater.push(compressed, true);
	if (outputSize !== expectedSize) throw new Error('Decompressed file size does not match metadata');
	const output = new Uint8Array(outputSize);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

// Decompress volumes back to file
// 将分卷解压回文件
async function createFileBlob(transfer) {
	if (transfer.blob) return transfer.blob;
	const { volumeData, totalVolumes, compression, originalSize, compressedSize, originalHash, fileType } = transfer;
	if (!(volumeData instanceof Map) || volumeData.size !== totalVolumes) throw new Error('File is missing one or more volumes');
	let blob;
	if (compression === 'chunked-deflate' || compression === 'chunked-raw') {
		const hash = sha256.create();
		const chunks = [];
		for (let index = 0; index < totalVolumes; index++) {
			const compressedChunk = volumeData.get(index);
			if (!(compressedChunk instanceof Uint8Array)) throw new Error('File is missing a volume');
			const expectedChunkSize = Math.min(LARGE_FILE_CHUNK_SIZE, originalSize - (index * LARGE_FILE_CHUNK_SIZE));
			const chunk = compression === 'chunked-raw' ? compressedChunk : inflateWithLimit(compressedChunk, expectedChunkSize);
			if (chunk.length !== expectedChunkSize) throw new Error('File chunk size does not match metadata');
			hash.update(chunk);
			chunks.push(chunk);
		}
		if (sha256HexRaw(hash.digest()) !== originalHash) throw new Error('File integrity check failed: hash mismatch');
		blob = new Blob(chunks, { type: fileType });
	} else {
		const compressed = new Uint8Array(compressedSize);
		let offset = 0;
		for (let index = 0; index < totalVolumes; index++) {
			const chunk = volumeData.get(index);
			if (!(chunk instanceof Uint8Array)) throw new Error('File is missing a volume');
			compressed.set(chunk, offset);
			offset += chunk.length;
		}
		if (offset !== compressedSize) throw new Error('Compressed file size does not match metadata');
		const decompressed = inflateWithLimit(compressed, originalSize);
		if (sha256HexRaw(decompressed) !== originalHash) throw new Error('File integrity check failed: hash mismatch');
		blob = new Blob([decompressed], { type: fileType });
	}
	transfer.blob = blob;
	transfer.volumeData.clear();
	return blob;
}

// Setup file sending functionality
// 设置文件发送功能
export function setupFileSend({
	inputSelector,
	attachBtnSelector,
	fileInputSelector,
	onSend
}) {
	const attachBtn = document.querySelector(attachBtnSelector);
	const input = document.querySelector(inputSelector);

	const openUploadModal = async (files = []) => {
		const normalizedFiles = normalizeClipboardFiles(files);
		const onModalSend = async (modalFiles) => {
			const userName = window.roomsData && window.activeRoomIndex >= 0
				? (window.roomsData[window.activeRoomIndex]?.myUserName || '')
				: '';
			await handleFilesUpload(modalFiles, (msg) => {
				return onSend({ ...msg, userName });
			});
		};
		if (normalizedFiles.length > 0) {
			await addFilesToUploadModal(normalizedFiles, onModalSend);
		} else {
			await showFileUploadModal(onModalSend);
		}
	};
	
	if (attachBtn) {
		// 点击附件按钮显示文件上传模态框
		// Click attach button to show file upload modal
		attachBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			openUploadModal();
		});
	}

	if (input) {
		input.addEventListener('paste', async (e) => {
			if (!e.clipboardData) return;
			const files = extractFilesFromClipboardData(e.clipboardData);
			if (files.length === 0) return;
			e.preventDefault();
			await openUploadModal(files);
		});
	}
}

function extractFilesFromClipboardData(clipboardData) {
	const files = [];
	if (!clipboardData || !clipboardData.items) return files;
	for (const item of clipboardData.items) {
		if (item.kind !== 'file') continue;
		const file = item.getAsFile();
		if (file) files.push(file);
	}
	return files;
}

function normalizeClipboardFiles(files) {
	if (!Array.isArray(files)) return [];
	return files.map((file) => {
		if (!(file instanceof File)) return file;
		const normalizedName = normalizeFileName(file);
		if (normalizedName === file.name) return file;
		return new File([file], normalizedName, { type: file.type, lastModified: file.lastModified || Date.now() });
	});
}

function normalizeFileName(file) {
	const rawName = typeof file.name === 'string' ? file.name.trim() : '';
	if (rawName) return rawName;
	const now = Date.now();
	const ext = inferExtension(file);
	return `${now}.${ext}`;
}

function inferExtension(file) {
	const mime = typeof file.type === 'string' ? file.type : '';
	if (mime.includes('/')) {
		const subtype = mime.split('/')[1].split(';')[0].trim();
		if (subtype) return subtype === 'jpeg' ? 'jpg' : subtype;
	}
	return 'bin';
}

// Handle files upload
// 处理文件上传
async function handleFilesUpload(files, onSend) {
	if (!files || files.length === 0) return;
	let preparationStatus = null;
	let activeTransfer = null;
	try {
		for (const sourceFile of files) {
			const shouldStripImageExif = getSetting('stripImageExif');
			const file = shouldStripImageExif ? await recreateImageWithoutExif(sourceFile) : sourceFile;
			const { coverData, audioTitle, audioArtist } = await extractAudioMetadata(file);
			const setPreparationStatus = (text) => {
				if (!preparationStatus) {
					const chatArea = document.querySelector('#chat-area');
					if (chatArea) {
						preparationStatus = document.createElement('div');
						preparationStatus.className = 'bubble system file-preparation-status';
						preparationStatus.setAttribute('role', 'status');
						preparationStatus.innerHTML = '<span class="bubble-content"></span>';
						chatArea.appendChild(preparationStatus);
					}
				}
				const content = preparationStatus?.querySelector('.bubble-content');
				if (content) content.textContent = text;
			};
			const prepared = await compressFileToVolumes(file, DEFAULT_VOLUME_SIZE, (processed, total) => {
					setPreparationStatus(`Preparing ${file.name}: ${Math.floor((processed / total) * 100)}%`);
				});
			preparationStatus?.remove();
			preparationStatus = null;
			const fileId = generateFileId();
			const { volumes, totalVolumes, originalSize, compressedSize, originalHash } = prepared;

			// Create file transfer state
			const fileTransfer = {
				fileId,
				fileName: file.name,
				fileType: file.type,
				previewData: null,
				previewUrl: file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/')
					? URL.createObjectURL(file)
					: null,
				coverData,
				audioTitle,
				audioArtist,
				originalSize,
				compressedSize,
				totalVolumes,
				sentVolumes: 0,
				status: 'sending',
				originalHash,
				volumeData: volumes,
				sourceFile: file,
				blob: file,
				compression: prepared.compression || 'deflate'
			};

			window.fileTransfers.set(fileId, fileTransfer);
			activeTransfer = fileTransfer;

			// Send file start message
			const started = await onSend({
				type: 'file_start',
				fileId,
				fileName: file.name,
				fileType: file.type,
				previewData: null,
				coverData,
				audioTitle,
				audioArtist,
				originalSize,
				compressedSize,
				totalVolumes,
				originalHash,
				compression: prepared.compression || 'deflate'
			});
			if (started === false) throw new Error(`Failed to send file metadata for ${file.name}`);

			// Send this file completely before moving to next one
			await sendVolumes(fileId, onSend, file.name);
			activeTransfer = null;
		}
		
	} catch (error) {
		if (activeTransfer?.status === 'sending') {
			activeTransfer.status = 'failed';
			activeTransfer.failureReason = error.message;
			activeTransfer.sendContext = null;
			updateFileProgress(activeTransfer.fileId);
		}
		console.error('File transfer error:', error);
		if (window.addSystemMsg) {
			window.addSystemMsg(`Failed to send file: ${error.message}`);
		}
	} finally {
		preparationStatus?.remove();
	}
}

async function recreateImageWithoutExif(file) {
	if (!(file instanceof File) || !file.type.startsWith('image/')) return file;

	if (file.type !== 'image/jpeg' && file.type !== 'image/png') return file;

	let objectUrl = '';

	try {
		const bitmap = typeof createImageBitmap === 'function'
			? await createImageBitmap(file, { imageOrientation: 'from-image' })
			: await new Promise((res, rej) => {
				const img = new Image();
				objectUrl = URL.createObjectURL(file);

				img.onload = () => {
					URL.revokeObjectURL(objectUrl);
					objectUrl = '';
					res(img);
				};

				img.onerror = (err) => {
					URL.revokeObjectURL(objectUrl);
					objectUrl = '';
					rej(err);
				};

				img.src = objectUrl;
			});

		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (!ctx) return file;

		canvas.width = bitmap.width;
		canvas.height = bitmap.height;

		ctx.drawImage(bitmap, 0, 0);
		bitmap.close?.();

		const blob = await new Promise((resolve) =>
			canvas.toBlob(resolve, file.type)
		);

		if (!blob) return file;

		return new File([blob], file.name, {
			type: file.type,
			lastModified: file.lastModified || Date.now()
		});
	} catch {
		return file;
	} finally {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
	}
}

// Send volumes with progress tracking
// 发送分卷并跟踪进度
async function sendVolumes(fileId, onSend, fileName) {
	const fileTransfer = window.fileTransfers.get(fileId);
	if (!fileTransfer) return;

	const batchSize = 5;
	for (let start = 0; start < fileTransfer.totalVolumes; start += batchSize) {
		const end = Math.min(start + batchSize, fileTransfer.totalVolumes);
		const messages = [];
		for (let index = start; index < end; index++) {
			let volumeData = fileTransfer.volumeData?.[index];
			if (fileTransfer.compression === 'chunked-raw') {
				const offset = index * LARGE_FILE_CHUNK_SIZE;
				const chunk = new Uint8Array(await fileTransfer.sourceFile.slice(offset, offset + LARGE_FILE_CHUNK_SIZE).arrayBuffer());
				volumeData = arrayBufferToBase64(chunk);
			}
			messages.push({
				type: 'file_volume',
				fileId,
				volumeIndex: index,
				volumeData,
				isLast: index === fileTransfer.totalVolumes - 1
			});
		}

		const sent = await Promise.all(messages.map((message) => onSend(message)));
		if (sent.some((result) => result === false)) throw new Error(`Failed to send file chunk ${start + 1}`);
		fileTransfer.sentVolumes = end;
		updateFileProgress(fileId);
		if (end < fileTransfer.totalVolumes) await new Promise((resolve) => setTimeout(resolve, 100));
	}

	const completed = await onSend({ type: 'file_complete', fileId });
	if (completed === false) throw new Error(`Failed to complete file transfer for ${fileName}`);
	fileTransfer.status = 'completed';
	fileTransfer.volumeData = null;
	updateFileProgress(fileId);
	window.updateFileMessagePreview?.(fileId);
}

// Update file progress in chat
// 更新聊天中的文件进度
function updateFileProgress(fileId) {
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer) return;
	const safeSelectorFileId = escapeSelectorValue(fileId);
	const elements = document.querySelectorAll(`[data-file-id="${safeSelectorFileId}"]`);
	elements.forEach(element => {
		const progressContainer = element.querySelector('.file-progress-container');
		const progressBar = element.querySelector('.file-progress');
		const statusText = element.querySelector('.file-status');
		const cancelDownloadBtn = element.querySelector('.file-cancel-download-btn');
		const downloadBtn = element.querySelector('.file-download-btn');
		
		// 判断是否为发送方（发送方没有volumeData）
		const isSender = Boolean(transfer.sourceFile);
		
		if (transfer.status === 'sending') {
			if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'none';
			const progress = (transfer.sentVolumes / transfer.totalVolumes) * 100;
			if (progressContainer) {
				progressContainer.style.display = 'block';
				progressContainer.classList.remove('fade-out');
			}
			if (progressBar) progressBar.style.width = `${progress}%`;
			if (statusText) statusText.textContent = `Uploading ${Math.floor(progress)}% (${transfer.sentVolumes}/${transfer.totalVolumes})`;
			if (downloadBtn) {
				downloadBtn.classList.remove('show', 'animate-in');
				downloadBtn.style.display = 'none';
			}
		} else if (transfer.status === 'receiving') {
			if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'inline-flex';
			const progress = (transfer.receivedVolumes.size / transfer.totalVolumes) * 100;
			if (progressContainer) {
				progressContainer.style.display = 'block';
				progressContainer.classList.remove('fade-out');
			}
			if (progressBar) progressBar.style.width = `${progress}%`;
			if (statusText) statusText.textContent = `Receiving ${transfer.receivedVolumes.size}/${transfer.totalVolumes}`;
			if (downloadBtn) {
				downloadBtn.classList.remove('show', 'animate-in');
				downloadBtn.style.display = 'none';
			}
		} else if (transfer.status === 'completed') {
			if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'none';
			// 传输完成时的动画序列
			if (progressContainer) {
				// 先添加淡出动画类
				progressContainer.classList.add('fade-out');
				// 延迟后完全隐藏
				setTimeout(() => {
					progressContainer.style.display = 'none';
				}, 400);
			}
			
			if (downloadBtn) {
				// 只有接收方才显示下载按钮
				if (isSender) {
					downloadBtn.classList.remove('show', 'animate-in');
					downloadBtn.style.display = 'none';
				} else {
					// 延迟显示下载按钮，等进度条消失动画完成
					setTimeout(() => {
						downloadBtn.style.display = 'flex';
						downloadBtn.classList.add('show');
						downloadBtn.disabled = false;
						// 添加进入动画
						setTimeout(() => {
							downloadBtn.classList.add('animate-in');
						}, 50);
						// 清理动画类
						setTimeout(() => {
							downloadBtn.classList.remove('animate-in');
						}, 550);
					}, 200);
				}
			}
		} else if (transfer.status === 'cancelled') {
			if (progressContainer) {
				progressContainer.style.display = 'block';
				progressContainer.classList.remove('fade-out');
			}
			if (progressBar) progressBar.style.width = '0%';
			if (statusText) statusText.textContent = t('file.download_stopped', 'Download stopped');
			if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'none';
			if (downloadBtn) {
				downloadBtn.classList.remove('show', 'animate-in');
				downloadBtn.style.display = 'none';
			}
		} else if (transfer.status === 'failed') {
			if (progressContainer) progressContainer.style.display = 'block';
			if (statusText) statusText.textContent = transfer.failureReason || 'File verification failed';
			if (cancelDownloadBtn) cancelDownloadBtn.style.display = 'none';
			if (downloadBtn) downloadBtn.style.display = 'none';
		}
	});
}

export async function extractAudioMetadata(file) {
	if (!file) {
		return { coverData: null, audioTitle: null, audioArtist: null };
	}

	if (!(file.type || '').startsWith('audio/')) {
		return { coverData: null, audioTitle: null, audioArtist: null };
	}

	try {
		const metadata = await parseBlob(file, { skipPostHeaders: true });
		const picture = metadata?.common?.picture?.[0];
		let coverData = null;

		if (picture?.data && picture.data.length > 0) {
			const mimeType = picture.format || 'image/jpeg';
			let binary = '';
			const chunkSize = 0x8000;

			for (let i = 0; i < picture.data.length; i += chunkSize) {
				const chunk = picture.data.subarray(i, i + chunkSize);
				binary += String.fromCharCode(...chunk);
			}

			coverData = `data:${mimeType};base64,${btoa(binary)}`;
		}

		return {
			coverData,
			audioTitle: metadata?.common?.title || null,
			audioArtist: metadata?.common?.artist || null
		};
	} catch (error) {
		console.warn('Failed to parse audio metadata:', error);
		return { coverData: null, audioTitle: null, audioArtist: null };
	}
}

export function getFileEmoji(fileName = '', fileType = '') {
	const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';

	const emojiByExtension = {
		mp3: '🎵', flac: '🎵', wav: '🎵', aac: '🎵', m4a: '🎵', ogg: '🎵', opus: '🎵',

		mp4: '🎬', mkv: '🎬', webm: '🎬', mov: '🎬', avi: '🎬',

		jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', bmp: '🖼️',

		pdf: '📕', doc: '📘', docx: '📘', odt: '📘',

		txt: '📄', rtf: '📄', md: '📝', markdown: '📝',

		json: '🧾', xml: '🧾',
		yml: '🧾', yaml: '🧾',
		toml: '🧾', ini: '🧾', conf: '🧾', config: '🧾',
		env: '🧾', lock: '🧾', log: '📜',

		xls: '📊', xlsx: '📊', csv: '📊', tsv: '📊',

		ppt: '📽️', pptx: '📽️',

		js: '💻', ts: '💻', jsx: '💻', tsx: '💻',
		py: '💻', java: '💻', c: '💻', cpp: '💻', cs: '💻',
		go: '💻', rs: '💻', php: '💻',
		html: '💻', css: '💻', scss: '💻', sass: '💻',
		sql: '💻', sh: '💻', bash: '💻',

		zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',

		exe: '⚙️', dmg: '💿', apk: '📱', ipa: '📱'
	};

	if (ext && emojiByExtension[ext]) return emojiByExtension[ext];

	if (fileType.startsWith('audio/')) return '🎵';
	if (fileType.startsWith('video/')) return '🎬';
	if (fileType.startsWith('image/')) return '🖼️';
	if (fileType.startsWith('text/')) return '📄';
	if (fileType.includes('json') || fileType.includes('xml')) return '🧾';
	if (fileType.includes('pdf')) return '📕';

	return '📁';
}

// Handle incoming file messages
// 处理接收到的文件消息
export function handleFileMessage(message, isPrivate = false) {
	const { type, fileId, userName } = message;
	if (!isValidFileId(fileId)) {
		console.warn('handleFileMessage rejected unsafe fileId:', fileId);
		return;
	}
	
	switch (type) {
		case 'file_start':
			handleFileStart(message, isPrivate);
			break;
		case 'file_volume':
			handleFileVolume(message);
			break;
		case 'file_complete':
			void handleFileComplete(message);
			break;
	}
}

// Handle file start message
// 处理文件开始消息
function handleFileStart(message, isPrivate) {
	const { fileId, fileName, fileType = '', previewData = null, coverData = null, audioTitle = null, audioArtist = null, originalSize, compressedSize, totalVolumes, originalHash, userName, clientId = null, avatar = '', userColor = null, securityMeta = null } = message;
	const compression = message.compression || 'deflate';
	const validInteger = (value) => Number.isSafeInteger(value) && value >= 0;
	const expectedVolumes = compression === 'chunked-raw' || compression === 'chunked-deflate'
		? Math.ceil(originalSize / LARGE_FILE_CHUNK_SIZE)
		: Math.ceil(compressedSize / DEFAULT_VOLUME_SIZE);
	if (
		!isValidFileId(fileId) || window.fileTransfers.has(fileId) ||
		typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 1024 ||
		typeof fileType !== 'string' || fileType.length > 256 ||
		!validInteger(originalSize) || !validInteger(compressedSize) || compressedSize === 0 ||
		!Number.isSafeInteger(totalVolumes) || totalVolumes < 1 ||
		totalVolumes !== expectedVolumes ||
		!['deflate', 'chunked-deflate', 'chunked-raw'].includes(compression) ||
		typeof originalHash !== 'string' || !/^[a-f0-9]{64}$/i.test(originalHash) ||
		(previewData !== null && typeof previewData !== 'string') ||
		(coverData !== null && typeof coverData !== 'string') ||
		(audioTitle !== null && (typeof audioTitle !== 'string' || audioTitle.length > 1024)) ||
		(audioArtist !== null && (typeof audioArtist !== 'string' || audioArtist.length > 1024))
	) {
		console.warn('Rejected invalid file_start metadata:', fileId);
		return;
	}
	
	const fileTransfer = {
		fileId,
		fileName,
		fileType,
		previewData,
		previewUrl: null,
		coverData,
		audioTitle,
		audioArtist,
		originalSize,
		compressedSize,
		totalVolumes,
		compression,
		receivedVolumes: new Set(),
		receivedCompressedSize: 0,
		volumeData: new Map(),
		status: 'receiving',
		originalHash,
		userName // 记录发送者名字
	};
	
	window.fileTransfers.set(fileId, fileTransfer);
	
	// 添加文件消息到聊天
	if (window.addOtherMsg) {
		const displayData = {
			type: 'file',
			fileId,
			fileName,
			fileType,
			previewData,
			coverData,
			audioTitle,
			audioArtist,
			originalSize,
			totalVolumes,
			userName
		};
		
		window.addOtherMsg(displayData, userName, avatar, false, isPrivate ? 'file_private' : 'file', null, clientId, userColor, securityMeta);
	}
}

// Handle file volume message
// 处理文件分卷消息
function handleFileVolume(message) {
	const { fileId, volumeIndex, volumeData } = message;
	const transfer = window.fileTransfers.get(fileId);
	
	if (!transfer || transfer.status !== 'receiving') return;
	if (!Number.isSafeInteger(volumeIndex) || volumeIndex < 0 || volumeIndex >= transfer.totalVolumes || transfer.receivedVolumes.has(volumeIndex)) return;
	if (typeof volumeData !== 'string' || volumeData.length === 0 || volumeData.length > Math.ceil(MAX_FILE_VOLUME_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(volumeData)) return;
	let decodedVolume;
	try {
		decodedVolume = base64ToArrayBuffer(volumeData);
	} catch {
		return;
	}
	if (decodedVolume.length === 0 || decodedVolume.length > MAX_FILE_VOLUME_BYTES) return;
	if (transfer.compression === 'deflate') {
		const expectedSize = Math.min(DEFAULT_VOLUME_SIZE, transfer.compressedSize - (volumeIndex * DEFAULT_VOLUME_SIZE));
		if (decodedVolume.length !== expectedSize) return;
	} else if (transfer.compression === 'chunked-raw') {
		const expectedSize = Math.min(LARGE_FILE_CHUNK_SIZE, transfer.originalSize - (volumeIndex * LARGE_FILE_CHUNK_SIZE));
		if (decodedVolume.length !== expectedSize) return;
	}
	if (transfer.receivedCompressedSize + decodedVolume.length > transfer.compressedSize) return;
	transfer.receivedVolumes.add(volumeIndex);
	transfer.receivedCompressedSize += decodedVolume.length;
	transfer.volumeData.set(volumeIndex, decodedVolume);
	
	updateFileProgress(fileId);
}

// Handle file complete message
// 处理文件完成消息
async function handleFileComplete(message) {
	const { fileId } = message;
	const transfer = window.fileTransfers.get(fileId);
	
	if (!transfer || transfer.status === 'cancelled') return;
	
	// 检查是否所有分卷都已接收
	if (transfer.receivedVolumes.size === transfer.totalVolumes && transfer.receivedCompressedSize === transfer.compressedSize) {
		try {
			if (/^(image|audio|video)\//.test(transfer.fileType)) {
				const blob = await createFileBlob(transfer);
				transfer.previewUrl = URL.createObjectURL(blob);
			}
			transfer.status = 'completed';
			window.updateFileMessagePreview?.(fileId);
		} catch (error) {
			console.error('File verification error:', error);
			transfer.status = 'failed';
			transfer.failureReason = `File verification failed: ${error.message}`;
			window.addSystemMsg?.(`File verification failed: ${error.message}`);
		}
		updateFileProgress(fileId);
	}
}

export function cancelFileDownload(fileId) {
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer || transfer.status !== 'receiving') return false;
	transfer.status = 'cancelled';
	transfer.volumeData.clear();
	transfer.receivedVolumes.clear();
	updateFileProgress(fileId);
	return true;
}

// Download file from volumes
// 从分卷下载文件
export async function downloadFile(fileId) {
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer || transfer.status !== 'completed') return;
	
	try {
		const blob = await createFileBlob(transfer);
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = transfer.fileName;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	} catch (error) {
		console.error('Download error:', error);
		window.addSystemMsg(`Failed to download: ${error.message}`);
	}
}

// Format file size
// 格式化文件大小
export function formatFileSize(bytes) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Legacy image send function for backward compatibility
// 向后兼容的图片发送函数
export function setupImageSend(config) {
	setupFileSend(config);
}
