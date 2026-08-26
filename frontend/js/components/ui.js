/**
 * UI helpers — shared rendering utilities for NMS pages.
 * Provides the common empty-state / spinner / confirm-delete / escaping
 * boilerplate that pages used to re-implement locally.
 */
const UI = {
    /** HTML-escape a string. */
    esc: Format.esc,

    /** Loading spinner placeholder. */
    spinner() {
        return '<div class="spinner"></div>';
    },

    /** Empty-state block (icon + text [+ optional hint]). */
    emptyState(icon, text, hint = '') {
        return `<div class="empty-state">
            <i class="${icon}" style="font-size:48px;color:#ccc;margin-bottom:10px;"></i>
            <p>${text}</p>
            ${hint ? `<small style="color:#999;">${hint}</small>` : ''}
        </div>`;
    },

    /** Confirm-before-destructive-action. Returns true only if the user confirms. */
    confirmDelete(message = '确定删除?') {
        return window.confirm(message);
    },
};
