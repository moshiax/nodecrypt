// Use DOMPurify to safely handle HTML content
// 使用 DOMPurify 安全处理 HTML 内容
import DOMPurify from 'dompurify';

// Escape HTML special characters
// 转义 HTML 特殊字符
export function escapeHTML(str) {
	if (typeof str !== 'string') return '';
	// 使用替换方法确保 HTML 特殊字符被转义，而不是被移除
	// 这样 <java> 会变成 &lt;java&gt; 而不是被删除
	return str.replace(/[&<>"']/g, function(c) {
		return {
			'&': '&amp;',  // & 转为 &amp;
			'<': '&lt;',   // < 转为 &lt;
			'>': '&gt;',   // > 转为 &gt;
			'"': '&quot;', // " 转为 &quot;
			"'": '&#39;'   // ' 转为 &#39;
		}[c];
	});
}

// Convert text to HTML, preserving line breaks
// 将文本转换为 HTML，保留换行符
export function textToHTML(text) {
	if (typeof text !== 'string') return '';
	const escaped = escapeHTML(text);
	const linkified = escaped.replace(
		/(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi,
		(rawMatch) => {
			const href = rawMatch.startsWith('http') ? rawMatch : `https://${rawMatch}`;
			const safeHref = escapeHTML(href);
			return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${rawMatch}</a>`;
		}
	);
	const withLineBreaks = linkified.replace(/\n/g, '<br>');
	return DOMPurify.sanitize(withLineBreaks, {
		ALLOWED_TAGS: ['br', 'a'],
		ALLOWED_ATTR: ['href', 'target', 'rel'],
	});
}