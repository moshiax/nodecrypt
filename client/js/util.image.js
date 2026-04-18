// Import DOM helpers
// 导入 DOM 辅助函数
import {
	$,
	on,
	createElement
} from './util.dom.js';

// Process and compress image file
// 处理并压缩图片文件
export async function processImage(file, callback) {
	// Create image element for loading file
	// 创建图片元素用于加载文件
	const img = new Image();
	img.onload = function() {
		const maxW = 1280, // Max width
			maxH = 1280;    // 最大宽度/高度
		let w = img.naturalWidth,
			h = img.naturalHeight;
		// Resize if too large
		// 如果图片过大则缩放
		if (w > maxW || h > maxH) {
			const scale = Math.min(maxW / w, maxH / h);
			w = Math.round(w * scale);
			h = Math.round(h * scale)
		}
		// Create canvas for drawing image
		// 创建画布用于绘制图片
		const canvas = createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		ctx.drawImage(img, 0, 0, w, h);
		let dataUrl;
		// Export as webp with 90% quality
		// 导出为 webp，90% 质量
		dataUrl = canvas.toDataURL('image/webp', 0.90);
		callback(dataUrl)
	};
	// Read file as data URL
	// 以 dataURL 方式读取文件
	const reader = new FileReader();
	reader.onload = function(e) {
		img.src = e.target.result
	};
	reader.readAsDataURL(file)
}

// Translate message key
// 翻译消息 key
function t(key) {
	const messages = {
		tooLarge: 'Image is too large (over 8MB)', // 图片过大（超过8MB）
	};
	return messages[key] || key
}

export function setupImagePaste(inputSelector) {
	const input = $(inputSelector);
	if (!input) return;

	// Function to update placeholder visibility
	function updatePlaceholderVisibility() {
		const placeholder = input.parentNode.querySelector('.input-field-placeholder');
		if (!placeholder) return;

		const hasText = input.innerText.trim().length > 0;
		const hasImages = false;

		if (hasText || hasImages) {
			placeholder.style.opacity = '0';
			input.classList.remove('is-empty'); // 确保移除 is-empty
		} else {
			placeholder.style.opacity = '1';
			input.classList.add('is-empty'); // 确保添加 is-empty
		}
	}

	// Initial check for placeholder
	updatePlaceholderVisibility();

	// Listen to input events to update placeholder
	on(input, 'input', updatePlaceholderVisibility);
	on(input, 'focus', updatePlaceholderVisibility);
	on(input, 'blur', () => {
		// Defer blur check slightly to allow click on remove button
		setTimeout(updatePlaceholderVisibility, 100);
	});

	return {
		getCurrentImages: () => [],
		clearImages: () => {},
		refreshPlaceholder: updatePlaceholderVisibility // 暴露 placeholder 更新函数
	};
}

// Setup legacy image send functionality (for backward compatibility)
// 设置旧版图片发送功能（向后兼容）
export function setupImageSend({
	inputSelector,
	attachBtnSelector,
	fileInputSelector,
	onSend
}) {
	const input = $(inputSelector);
	const attachBtn = $(attachBtnSelector);
	const fileInput = $(fileInputSelector);
	
	if (fileInput) fileInput.setAttribute('accept', 'image/*');
	
	if (attachBtn && fileInput) {
		// Click attach triggers file input
		// 点击附件按钮触发文件选择
		on(attachBtn, 'click', () => fileInput.click());
		
		// Handle file input change
		// 处理文件选择变化
		on(fileInput, 'change', async function() {
			if (!fileInput.files || !fileInput.files.length) return;
			const file = fileInput.files[0];
			
			// Only allow image files
			// 只允许图片文件
			if (!file.type.startsWith('image/')) return;
			
			// Check file size
			// 检查文件大小
			if (file.size > 5 * 1024 * 1024) {
				alert(t('tooLarge'));
				return
			}
			
			processImage(file, (dataUrl) => {
				if (typeof onSend === 'function') onSend(dataUrl)
			});
			fileInput.value = ''
		})
	}
	
	if (input) {
		// Paste image from clipboard
		// 从剪贴板粘贴图片
		on(input, 'paste', function(e) {
			if (!e.clipboardData) return;
			for (const item of e.clipboardData.items) {
				// Only handle image type
				// 只处理图片类型
				if (item.type.startsWith('image/')) {
					const file = item.getAsFile();
					if (!file) continue;
					
					// Check file size
					// 检查文件大小
					if (file.size > 5 * 1024 * 1024) {
						alert(t('tooLarge'));
						continue
					}
					
					processImage(file, (dataUrl) => {
						if (typeof onSend === 'function') onSend(dataUrl)
					});
					e.preventDefault();
					break
				}
			}
		})
	}
}
