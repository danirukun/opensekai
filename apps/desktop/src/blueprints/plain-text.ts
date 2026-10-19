// The UI kit does not pass extra attributes to its inputs, so this action sets them on each text field inside `node`,
// also on fields added later. It stops macOS autocorrect and smart quotes in fields that hold literal text.
const ATTRIBUTES = [['autocorrect', 'off'], ['autocapitalize', 'off'], ['spellcheck', 'false']] as const;
const FIELDS = 'textarea, input:not([type]), input[type=text]';
const apply = (root: HTMLElement) => root.querySelectorAll(FIELDS).forEach(field => ATTRIBUTES.forEach(([name, value]) => field.setAttribute(name, value)));
export function plainText(node: HTMLElement) {
 apply(node);
 const observer = new MutationObserver(() => apply(node));
 observer.observe(node, { childList: true, subtree: true });
 return { destroy: () => observer.disconnect() };
}
