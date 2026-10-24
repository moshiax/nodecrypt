import { $, on } from './util.dom.js';
import { setupFileSend } from './util.file.js';

export function setupImagePaste(inputSelector) {
	const input = $(inputSelector);
	if (!input) return;

	function updatePlaceholderVisibility() {
		const placeholder = input.parentNode.querySelector('.input-field-placeholder');
		if (!placeholder) return;
		const hasText = input.innerText.trim().length > 0;
		placeholder.style.opacity = hasText ? '0' : '1';
		input.classList.toggle('is-empty', !hasText);
	}

	updatePlaceholderVisibility();
	on(input, 'input', updatePlaceholderVisibility);
	on(input, 'focus', updatePlaceholderVisibility);
	on(input, 'blur', () => setTimeout(updatePlaceholderVisibility, 100));

	return {
		getCurrentImages: () => [],
		clearImages: () => {},
		refreshPlaceholder: updatePlaceholderVisibility
	};
}

export function setupImageSend(config) {
	setupFileSend(config);
}
