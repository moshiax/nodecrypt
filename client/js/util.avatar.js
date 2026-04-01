// JDenticon avatar generator
// 基于 JDenticon 的头像生成器

const AVATAR_SIZE = 64;

window.jdenticon.configure({
	backColor: 'transparent',
	padding: 0.08,
	saturation: { color: 0.6, grayscale: 0.0 },
	lightness: { color: [0.35, 0.7], grayscale: [0.3, 0.9] }
});

// Create SVG avatar for user name
// 为用户名生成 SVG 头像
export function createAvatarSVG(seedValue) {
  const seed = String(seedValue);
  return window.jdenticon.toSvg(seed, AVATAR_SIZE);
}

export function getColor(seedValue) {
	const seed = String(seedValue);
	let hash = 0;

	for (let i = 0; i < seed.length; i++) {
		hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
	}

	const h = Math.abs(hash) % 360;
	const s = 95;
	const l = (hash % 2 === 0)
		? 72
		: 38;

	return `hsl(${h} ${s}% ${l}%)`;
}

export function formatFingerprintColon(hexValue, pairs = 16) {
	const normalized = String(hexValue).replace(/[^a-fA-F0-9]/g, '').toUpperCase();
	const take = Math.max(1, pairs) * 2;
	const sliced = normalized.slice(0, take);
	const chunks = [];
	for (let i = 0; i < sliced.length; i += 2) {
		chunks.push(sliced.slice(i, i + 2));
	}
	return chunks.join(':');
}