// Import DOM utility functions
// 导入 DOM 工具函数
import {
	$,
	$$,
	$id,
	createElement,
	on,
	off,
	addClass,
	removeClass
} from './util.dom.js';

// Import theme utilities
// 导入主题工具函数
import { THEMES, getCurrentTheme, applyTheme } from './util.theme.js';

// Import i18n utilities
// 导入国际化工具函数
import { t, setLanguage, getCurrentLanguage, initI18n } from './util.i18n.js';
const SETTINGS_SCHEMA = {
	notify: { default: false },
	sound: { default: false },
	theme: { default: 'theme1' },
	uiTheme: { default: 'light' },
	previews: { default: true },
	stripImageExif: { default: false },
	language: { default: undefined }
};

const DEFAULT_SETTINGS = Object.fromEntries(
	Object.entries(SETTINGS_SCHEMA)
		.filter(([, config]) => typeof config.default !== 'undefined')
		.map(([key, config]) => [key, config.default])
);

const SETTINGS_PANEL_SECTIONS = [
	{
		titleKey: 'settings.notification',
		items: [
			{ key: 'notify', type: 'toggle', labelKey: 'settings.desktop_notifications' },
			{ key: 'sound', type: 'toggle', labelKey: 'settings.sound_notifications' }
		]
	},
	{
		titleKey: 'settings.language',
		items: [
			{
				key: 'language',
				type: 'select',
				labelKey: 'settings.language_switch',
				options: [
					{ value: 'en', label: '🇺🇸 English' },
					{ value: 'zh', label: '🇨🇳 中文' }
				]
			}
		]
	},
	{
		titleKey: 'settings.theme',
		items: [
			{
				key: 'uiTheme',
				type: 'select',
				labelKey: 'settings.ui_theme',
				options: [
					{ value: 'amoled', label: 'AMOLED' },
					{ value: 'light', label: 'Light' }
				]
			},
			{ key: 'theme', type: 'themePicker' }
		]
	},
	{
		titleKey: 'settings.chat',
		items: [
			{ key: 'previews', type: 'toggle', labelKey: 'settings.previews' },
			{ key: 'stripImageExif', type: 'toggle', labelKey: 'settings.photo_exif_cleanup' }
		]
	}
];

// Load settings from localStorage
// 从 localStorage 加载设置
function loadSettings() {
	let s = localStorage.getItem('settings');
	try {
		s = s ? JSON.parse(s) : {}
	} catch {
		s = {}
	}
	return {
		...DEFAULT_SETTINGS,
		...s
	}
}

// Save settings to localStorage
// 保存设置到 localStorage
function saveSettings(settings) {
	const persistedSettings = Object.keys(SETTINGS_SCHEMA).reduce((acc, key) => {
		if (typeof settings[key] !== 'undefined') {
			acc[key] = settings[key];
		}
		return acc;
	}, {});
	localStorage.setItem('settings', JSON.stringify(persistedSettings))
}

export function getSetting(key) {
	const settings = loadSettings();

	if (key in settings) return settings[key];
	return SETTINGS_SCHEMA[key]?.default;
}
function applyUITheme(uiTheme) {
	const theme = uiTheme || 'light';
	document.documentElement.setAttribute('data-ui-theme', theme);
	document.body.setAttribute('data-ui-theme', theme);
}

function renderSettingsItem(settings, item) {
	if (item.type === 'themePicker') {
		return `
			<div class="theme-selector" id="theme-selector">
				${THEMES.map(theme => `
					<div class="theme-item ${settings.theme === theme.id ? 'active' : ''}" data-theme-id="${theme.id}" style="background: ${theme.background}; background-size: cover; background-position: center;">
					</div>
				`).join('')}
			</div>
		`;
	}

	const label = t(item.labelKey);
	if (item.type === 'toggle') {
		return `
			<div class="settings-item">
				<div class="settings-item-label"><div>${label}</div></div>
				<label class="switch">
					<input type="checkbox" data-setting-key="${item.key}" ${settings[item.key] ? 'checked' : ''}>
					<span class="slider"></span>
				</label>
			</div>
		`;
	}

	if (item.type === 'select') {
		const optionsHtml = (item.options || []).map((option) => `
			<option value="${option.value}" ${settings[item.key] === option.value ? 'selected' : ''}>${option.label}</option>
		`).join('');
		return `
			<div class="settings-item">
				<div class="settings-item-label"><div>${label}</div></div>
				<div class="language-selector">
					<select class="language-select" data-setting-key="${item.key}">${optionsHtml}</select>
				</div>
			</div>
		`;
	}

	return '';
}

function renderSettingsPanel(settings) {
	return SETTINGS_PANEL_SECTIONS.map((section) => `
		<div class="settings-section">
			<div class="settings-section-title">${t(section.titleKey, section.titleFallback)}</div>
			${section.items.map((item) => renderSettingsItem(settings, item)).join('')}
		</div>
	`).join('');
}

// Apply settings to the document
// 应用设置到文档
function applySettings(settings) {
	initI18n(settings);
	applyUITheme(settings.uiTheme);
}


// Ask for browser notification permission
// 请求浏览器通知权限
function askNotificationPermission(callback) {
	if (Notification.requestPermission.length === 0) {
		Notification.requestPermission().then(callback)
	} else {
		Notification.requestPermission(callback)
	}
}

// Setup the settings panel UI
// 设置设置面板 UI
function setupSettingsPanel() {
	const settingsSidebar = $id('settings-sidebar');
	const settingsContent = $id('settings-content');
	const settingsTitle = $id('settings-title');
	if (!settingsSidebar || !settingsContent) return;

	const settings = loadSettings();
	
	// Update settings title
	// 更新设置标题
	if (settingsTitle) {
		settingsTitle.textContent = t('settings.title', 'Settings');
	}
	settingsContent.innerHTML = renderSettingsPanel(settings);
	const notifyCheckbox = $('[data-setting-key="notify"]', settingsContent);
	const soundCheckbox = $('[data-setting-key="sound"]', settingsContent);

	$$('[data-setting-key]', settingsContent).forEach((control) => {
		on(control, 'change', (e) => {
			const key = e.target.getAttribute('data-setting-key');
			if (!key || key === 'notify' || key === 'sound') return;
			settings[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
			saveSettings(settings);
			if (key === 'uiTheme') {
				applyUITheme(settings.uiTheme);
			}
			if (key === 'language') {
				setLanguage(settings.language);
				applySettings(settings);
				setTimeout(() => {
					setupSettingsPanel();
				}, 100);
			}
		});
	});


	on(notifyCheckbox, 'change', e => {
		const checked = e.target.checked;
		if (checked) {
			if (!('Notification' in window)) {
				alert('Notifications are not supported by your browser.');
				e.target.checked = false;
				return
			}
			askNotificationPermission(permission => {
				if (permission === 'granted') {
					settings.notify = true;
					settings.sound = false;
					if (soundCheckbox) soundCheckbox.checked = false;
					saveSettings(settings);
					applySettings(settings);					// 防止重复通知，添加一个标志位
					if (!settingsSidebar._notificationShown) {
						new Notification('Notifications enabled', {
							body: 'You will receive alerts here.'
						});
						settingsSidebar._notificationShown = true; // 设置标志位
					}
				} else {
					settings.notify = false;
					e.target.checked = false;
					saveSettings(settings);
					applySettings(settings);
					alert('Please allow notifications in your browser settings.')
				}
			})
		} else {
			settings.notify = false;
			saveSettings(settings);
			applySettings(settings);			// 重置标志位
			if (settingsSidebar._notificationShown) {
				settingsSidebar._notificationShown = false;
			}
		}
	});	on(soundCheckbox, 'change', e => {
		settings.sound = e.target.checked;
		if (settings.sound) {
			settings.notify = false;
			if (notifyCheckbox) notifyCheckbox.checked = false;
		}
		saveSettings(settings);
		applySettings(settings)
	});
	// Theme selection event handlers
	// 主题选择事件处理
	const themeSelector = $('#theme-selector', settingsContent);
	if (themeSelector) {
		// Custom scrolling functionality
		// 自定义滚动功能
		let isDragging = false;
		let startX = 0;
		let scrollLeft = 0;

		// Mouse wheel scrolling (vertical -> horizontal)
		// 鼠标滚轮滚动（垂直转水平）
		on(themeSelector, 'wheel', e => {
			e.preventDefault();
			const scrollAmount = e.deltaY * 0.5; // Adjust scroll sensitivity
			themeSelector.scrollLeft += scrollAmount;
		});
		// Mouse drag scrolling
		// 鼠标拖拽滚动
		let dragStartTime = 0;
		let hasDragged = false;
		
		on(themeSelector, 'mousedown', e => {
			isDragging = true;
			hasDragged = false;
			dragStartTime = Date.now();
			startX = e.pageX - themeSelector.offsetLeft;
			scrollLeft = themeSelector.scrollLeft;
			themeSelector.classList.add('dragging');
			e.preventDefault(); // Prevent text selection
		});
		on(document, 'mousemove', e => {
			if (!isDragging) return;
			e.preventDefault();
			const x = e.pageX - themeSelector.offsetLeft;
			const walk = (x - startX) * 2; // Scroll speed multiplier
			const moved = Math.abs(walk);
			
			// If moved more than 5px, consider it a drag
			if (moved > 5) {
				hasDragged = true;
			}
			
			themeSelector.scrollLeft = scrollLeft - walk;
		});

		on(document, 'mouseup', () => {
			if (isDragging) {
				isDragging = false;
				themeSelector.classList.remove('dragging');
			}
		});
		// Touch support for mobile
		// 移动端触摸支持
		let touchStartX = 0;
		let touchScrollLeft = 0;
		let touchStartTime = 0;
		let touchHasMoved = false;

		on(themeSelector, 'touchstart', e => {
			touchStartX = e.touches[0].clientX;
			touchScrollLeft = themeSelector.scrollLeft;
			touchStartTime = Date.now();
			touchHasMoved = false;
		});

		on(themeSelector, 'touchmove', e => {
			e.preventDefault();
			const touchX = e.touches[0].clientX;
			const walk = (touchStartX - touchX) * 1.5; // Touch scroll sensitivity
			
			// If moved more than 10px, consider it a swipe
			if (Math.abs(walk) > 10) {
				touchHasMoved = true;
			}
			
			themeSelector.scrollLeft = touchScrollLeft + walk;
		});

		// Handle touch end for theme selection
		// 处理触摸结束的主题选择
		on(themeSelector, 'touchend', e => {
			// If user swiped, don't trigger theme selection
			// 如果用户滑动过，不触发主题选择
			if (touchHasMoved) {
				touchHasMoved = false;
				return;
			}
			
			// Check if it was a quick tap
			// 检查是否是快速点击
			const tapDuration = Date.now() - touchStartTime;
			if (tapDuration > 300) {
				return;
			}
			
			const themeItem = e.target.closest('.theme-item');
			if (themeItem) {
				const themeId = themeItem.dataset.themeId;
				if (themeId && themeId !== settings.theme) {
					// Update active state
					$$('.theme-item', themeSelector).forEach(item => {
						item.classList.remove('active');
					});
					themeItem.classList.add('active');
					
					// Apply theme and save settings
					settings.theme = themeId;
					applyTheme(themeId);
					saveSettings(settings);
				}
			}
		});
		// Theme selection click handler
		// 主题选择点击处理器
		on(themeSelector, 'click', e => {
			// If user just dragged, don't trigger theme selection
			// 如果用户刚刚拖拽过，不触发主题选择
			if (hasDragged) {
				hasDragged = false;
				return;
			}
			
			// Also check if it was a quick click (less than 200ms and minimal movement)
			// 同时检查是否是快速点击（少于200ms且移动很少）
			const clickDuration = Date.now() - dragStartTime;
			if (clickDuration > 200) {
				return;
			}
			
			const themeItem = e.target.closest('.theme-item');
			if (themeItem) {
				const themeId = themeItem.dataset.themeId;
				if (themeId && themeId !== settings.theme) {
					// Update active state
					$$('.theme-item', themeSelector).forEach(item => {
						item.classList.remove('active');
					});
					themeItem.classList.add('active');
					
					// Apply theme and save settings
					settings.theme = themeId;
					applyTheme(themeId);
					saveSettings(settings);
				}
			}
		});
	}
}

// Check if device is mobile
function isMobile() {
	return window.innerWidth <= 768;
}

// Open the settings panel
// 打开设置面板
function openSettingsPanel() {
	const settingsSidebar = $id('settings-sidebar');
	const sidebar = $id('sidebar');
	const sidebarMask = $id('mobile-sidebar-mask');
	
	if (!settingsSidebar || !sidebar) return;
	
	if (isMobile()) {
		// Mobile: hide main sidebar and show settings sidebar with mask
		sidebar.classList.remove('mobile-open');
		settingsSidebar.style.display = 'flex';
		// Force reflow then add animation class
		settingsSidebar.offsetHeight;
		settingsSidebar.classList.add('mobile-open');
		if (sidebarMask) {
			sidebarMask.classList.add('active');
		}	} else {
		// Desktop: show settings sidebar as overlay with slide animation
		settingsSidebar.style.display = 'flex';
		// Force reflow then slide in
		settingsSidebar.offsetHeight;
		settingsSidebar.classList.add('open');
		// Keep main sidebar visible - settings sidebar is an overlay
	}
	
	// Setup settings content
	setupSettingsPanel();
}

// Close the settings panel
// 关闭设置面板
function closeSettingsPanel() {
	const settingsSidebar = $id('settings-sidebar');
	const sidebarMask = $id('mobile-sidebar-mask'); // mobile-sidebar-mask is used for settings on mobile

	if (!settingsSidebar) return;

	const animationEnded = () => {
		settingsSidebar.style.display = 'none';
		settingsSidebar.removeEventListener('transitionend', animationEnded);
	};

	if (isMobile()) {
		settingsSidebar.classList.remove('mobile-open');
		if (sidebarMask) {
			sidebarMask.classList.remove('active');
		}
		// Listen for transition end to set display none
		settingsSidebar.addEventListener('transitionend', animationEnded);
		// Fallback if transitionend doesn't fire (e.g., if no transition is defined or display:none is set too early by other means)
		setTimeout(() => {
			if (!settingsSidebar.classList.contains('mobile-open')) { // check if it wasn't reopened
				settingsSidebar.style.display = 'none';
			}
		}, 350); // Slightly longer than CSS transition
	} else {
		settingsSidebar.classList.remove('open');
		// Listen for transition end to set display none
		settingsSidebar.addEventListener('transitionend', animationEnded);
		// Fallback
		setTimeout(() => {
			if (!settingsSidebar.classList.contains('open')) { // check if it wasn't reopened
				settingsSidebar.style.display = 'none';
			}
		}, 350);
	}
}

// Initialize settings on page load
// 页面加载时初始化设置
function initSettings() {
	const settings = loadSettings();
	applySettings(settings);
	
	// Apply theme from settings
	// 从设置中应用主题
	if (settings.theme) {
		applyTheme(settings.theme);
	}
	
	// Listen for language change events to update UI
	// 监听语言变更事件以更新UI
	window.addEventListener('languageChange', () => {
		// Update settings title if settings panel is open
		// 如果设置面板已打开，更新设置标题
		const settingsTitle = $id('settings-title');
		if (settingsTitle) {
			settingsTitle.textContent = t('settings.title', 'Settings');
		}
	});
}

// Play sound notification
// 播放声音通知
function playSoundNotification() {
	try {
		const ctx = new(window.AudioContext || window.webkitAudioContext)();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.frequency.value = 1000;
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start();
		gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
		setTimeout(() => {
			osc.stop();
			ctx.close()
		}, 600)
	} catch (e) {
		console.error('Sound notification failed', e)
	}
}

// Show desktop notification
// 显示桌面通知
function showDesktopNotification(roomName, text, msgType, sender) {
	if (!('Notification' in window) || Notification.permission !== 'granted') return;
	new Notification(`#${roomName}`, {
		body: t('notification.new_message')
	})
}

// Notify message entry point
// 通知消息主入口
export function notifyMessage(roomName, msgType, text, sender) {
	const settings = loadSettings();
	if (settings.notify) {
		showDesktopNotification(roomName, text, msgType, sender)
	} else if (settings.sound) {
		playSoundNotification()
	}
}
export {
	openSettingsPanel,
	closeSettingsPanel,
	initSettings
};
