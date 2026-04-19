// Import necessary modules
// 导入必要的模块
import { deflate, inflate } from 'fflate';
import { parseBlob } from 'music-metadata';
import { showFileUploadModal, addFilesToUploadModal } from './util.fileUpload.js';
import { escapeHTML } from './util.string.js';
import { getSetting } from './util.settings.js';

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
const DEFAULT_VOLUME_SIZE = 256 * 1024; // 512KB
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

// Calculate SHA-256 hash for data integrity verification
// 计算SHA-256哈希值用于数据完整性验证
async function calculateHash(data) {
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}



// Compress file into volumes with optimized compression
// 将文件压缩为分卷，优化压缩算法
async function compressFileToVolumes(file, volumeSize = DEFAULT_VOLUME_SIZE) { // 96KB原始数据，base64后约128KB
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = async function(e) {
			const arrayBuffer = new Uint8Array(e.target.result);
			
			try {
				// Calculate hash of original file for integrity
				const originalHash = await calculateHash(arrayBuffer);
				
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

// Decompress volumes back to file
// 将分卷解压回文件
async function decompressVolumesToFile(volumes, fileName, originalHash = null, fileType = '') {
	try {
		// Combine all volumes using base64 decoding
		const combinedData = volumes.map(volume => {
			return base64ToArrayBuffer(volume);
		});
		
		const totalLength = combinedData.reduce((sum, arr) => sum + arr.length, 0);
		const compressed = new Uint8Array(totalLength);
		let offset = 0;
		
		for (const data of combinedData) {
			compressed.set(data, offset);
			offset += data.length;
		}
				// Decompress
		return new Promise((resolve, reject) => {
			inflate(compressed, async (err, decompressed) => {
				if (err) {
					reject(err);
					return;
				}
				
				// Verify hash if provided
				if (originalHash) {
					try {
						const calculatedHash = await calculateHash(decompressed);
						if (calculatedHash !== originalHash) {
							reject(new Error('File integrity check failed: hash mismatch'));
							return;
						}
					} catch (hashError) {
						reject(new Error('File integrity check failed: ' + hashError.message));
						return;
					}
				}
				
				// Create blob and download
				const blob = new Blob([decompressed]);
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = fileName;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
				
				resolve();
			});
		});
	} catch (error) {
		console.error('Decompression error:', error);
		throw error;
	}
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
				onSend({ ...msg, userName });
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
	try {
		// Show compression progress
		let progressElement = null;
		
		function showProgress(message) {
			// 删除系统提示
		}
		
		function updateProgress(message) {
			// 删除系统提示
		}
		
		for (const sourceFile of files) {
			const shouldStripImageExif = getSetting('stripImageExif');
			const file = shouldStripImageExif ? await recreateImageWithoutExif(sourceFile) : sourceFile;
			const fileId = generateFileId();
			showProgress();
			const previewData = await createFilePreviewData(file);
			const { coverData, audioTitle, audioArtist } = await extractAudioMetadata(file);
			const { volumes, originalSize, compressedSize, originalHash } = await compressFileToVolumes(file);

			updateProgress();

			// Create file transfer state
			const fileTransfer = {
				fileId,
				fileName: file.name,
				fileType: file.type,
				previewData,
				coverData,
				audioTitle,
				audioArtist,
				originalSize,
				compressedSize,
				totalVolumes: volumes.length,
				sentVolumes: 0,
				status: 'sending',
				originalHash,
				volumeData: volumes
			};

			window.fileTransfers.set(fileId, fileTransfer);

			// Send file start message
			onSend({
				type: 'file_start',
				fileId,
				fileName: file.name,
				fileType: file.type,
				previewData,
				coverData,
				audioTitle,
				audioArtist,
				originalSize,
				compressedSize,
				totalVolumes: volumes.length,
				originalHash
			});

			// Send this file completely before moving to next one
			await sendVolumes(fileId, volumes, onSend, updateProgress, file.name);
		}
		
	} catch (error) {
		console.error('File compression error:', error);
		if (window.addSystemMsg) {
			window.addSystemMsg(`Failed to compress files: ${error.message}`);
		}
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

async function createFilePreviewData(file) {
	if (!file) return null;

	const inferredType = file.type || '';

	if (
		!inferredType.startsWith('image/') &&
		!inferredType.startsWith('audio/') &&
		!inferredType.startsWith('video/')
	) return null;

	return await new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = (event) => resolve(event.target.result);
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(file);
	});
}

// Send volumes with progress tracking
// 发送分卷并跟踪进度
async function sendVolumes(fileId, volumes, onSend, updateProgress, fileName) {
	const fileTransfer = window.fileTransfers.get(fileId);
	if (!fileTransfer) return;

	await new Promise((resolve) => {
		let currentVolume = 0;
		const batchSize = 5; // 每批发送5个分卷

		function sendNextBatch() {
			if (currentVolume >= volumes.length) {
				// 发送完成消息
				onSend({
					type: 'file_complete',
					fileId
				});

				fileTransfer.status = 'completed';
				updateFileProgress(fileId);
				updateProgress(`✓ Sent ${fileName} successfully`);
				resolve();
				return;
			}

			// 发送当前批次
			const batchEnd = Math.min(currentVolume + batchSize, volumes.length);
			const batch = [];

			for (let i = currentVolume; i < batchEnd; i++) {
				batch.push({
					type: 'file_volume',
					fileId,
					volumeIndex: i,
					volumeData: volumes[i],
					isLast: i === volumes.length - 1
				});
			}

			// 发送批次中的所有分卷
			batch.forEach(volumeMsg => onSend(volumeMsg));

			// 更新发送进度
			fileTransfer.sentVolumes = batchEnd;
			updateFileProgress(fileId);

			currentVolume = batchEnd;

			// 继续发送下一批，使用较短的延迟
			setTimeout(sendNextBatch, 100);
		}

		// 开始发送
		sendNextBatch();
	});
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
		const downloadBtn = element.querySelector('.file-download-btn');
		
		// 判断是否为发送方（发送方没有volumeData）
		const isSender = !transfer.volumeData || transfer.volumeData.length === 0;
		
		if (transfer.status === 'sending') {
			const progress = (transfer.sentVolumes / transfer.totalVolumes) * 100;
			if (progressContainer) {
				progressContainer.style.display = 'block';
				progressContainer.classList.remove('fade-out');
			}
			if (progressBar) progressBar.style.width = `${progress}%`;
			if (statusText) statusText.textContent = `Sending ${transfer.sentVolumes}/${transfer.totalVolumes}`;
			if (downloadBtn) {
				downloadBtn.classList.remove('show', 'animate-in');
				downloadBtn.style.display = 'none';
			}
		} else if (transfer.status === 'receiving') {
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
			handleFileComplete(message);
			break;
	}
}

// Handle file start message
// 处理文件开始消息
function handleFileStart(message, isPrivate) {
	const { fileId, fileName, fileType = '', previewData = null, coverData = null, audioTitle = null, audioArtist = null, originalSize, compressedSize, totalVolumes, originalHash, userName, clientId = null, avatar = '', userColor = null, securityMeta = null } = message;
	
	const fileTransfer = {
		fileId,
		fileName,
		fileType,
		previewData,
		coverData,
		audioTitle,
		audioArtist,
		originalSize,
		compressedSize,
		totalVolumes,
		receivedVolumes: new Set(),
		volumeData: new Array(totalVolumes),
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
	
	if (!transfer) return;
	
	transfer.receivedVolumes.add(volumeIndex);
	transfer.volumeData[volumeIndex] = volumeData;
	
	updateFileProgress(fileId);
}

// Handle file complete message
// 处理文件完成消息
function handleFileComplete(message) {
	const { fileId } = message;
	const transfer = window.fileTransfers.get(fileId);
	
	if (!transfer) return;
	
	// 检查是否所有分卷都已接收
	if (transfer.receivedVolumes.size === transfer.totalVolumes) {
		transfer.status = 'completed';
		updateFileProgress(fileId);
	}
}

// Download file from volumes
// 从分卷下载文件
export async function downloadFile(fileId) {
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer || transfer.status !== 'completed') return;
	
	try {
		await decompressVolumesToFile(transfer.volumeData, transfer.fileName, transfer.originalHash, transfer.fileType);
		// 删除系统提示
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
