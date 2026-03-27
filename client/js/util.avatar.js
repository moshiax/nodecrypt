// JDenticon avatar generator
// 基于 JDenticon 的头像生成器
import { sha256 } from 'js-sha256';

// Default icon size for chat avatars
// 聊天头像的默认尺寸
const AVATAR_SIZE = 64;

// Configure jdenticon once
// 初始化 jdenticon 配置
function ensureJdenticonConfigured() {
	if (!window.jdenticon) return false;
	if (window.__nodecryptJdenticonConfigured) return true;
	window.jdenticon.configure({
		backColor: 'transparent',
		padding: 0.08,
		saturation: { color: 0.6, grayscale: 0.0 },
		lightness: { color: [0.35, 0.7], grayscale: [0.3, 0.9] }
	});
	window.__nodecryptJdenticonConfigured = true;
	return true
}

// SHA-256 helper for stable identicon input
// SHA-256 辅助函数，保证输入稳定
function sha256HexSync(str) {
	return sha256(str)
}

// Create SVG avatar for user name
// 为用户名生成 SVG 头像
export function createAvatarSVG(userName) {
	const seed = String(userName || 'anonymous');
	const hash = sha256HexSync(seed);
	if (ensureJdenticonConfigured() && typeof window.jdenticon.toSvg === 'function') {
		return window.jdenticon.toSvg(hash, AVATAR_SIZE)
	}
	// Safe fallback if jdenticon script is unavailable
	// jdenticon 脚本不可用时的安全回退
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}"><rect width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" rx="12" fill="#6b7280"/><text x="50%" y="54%" text-anchor="middle" font-size="28" fill="#fff" font-family="sans-serif">${seed.slice(0, 1).toUpperCase()}</text></svg>`
}
