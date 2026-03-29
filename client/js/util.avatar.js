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

// Create SVG avatar for user name
// 为用户名生成 SVG 头像
export function createAvatarSVG(userName) {
  const seed = String(userName || 'anonymous');
  const hash = sha256(seed);
  if (ensureJdenticonConfigured() && typeof window.jdenticon.toSvg === 'function') {
    return window.jdenticon.toSvg(hash, AVATAR_SIZE);
  }
}