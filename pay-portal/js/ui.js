// ============================================================================
// UI helpers shared across every page: toasts, modals, theme, sidebar.
// ============================================================================

export function initTheme() {
  const stored = localStorage.getItem('tda-pay-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', stored ? stored === 'dark' : prefersDark);
}

export function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('tda-pay-theme', isDark ? 'dark' : 'light');
}

let toastContainer;
function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[90vw]';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

const TOAST_STYLES = {
  success: { bg: 'bg-emerald-600', icon: '✓' },
  error: { bg: 'bg-red-600', icon: '✕' },
  warning: { bg: 'bg-amber-500', icon: '!' },
  info: { bg: 'bg-blue-700', icon: 'i' },
};

export function toast(message, type = 'info', duration = 4500) {
  const container = getToastContainer();
  const style = TOAST_STYLES[type] || TOAST_STYLES.info;
  const el = document.createElement('div');
  el.className = `${style.bg} text-white rounded-lg shadow-lg px-4 py-3 flex items-start gap-3 translate-x-[110%] opacity-0 transition-all duration-300 ease-out`;
  el.innerHTML = `
    <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/25 text-xs font-bold">${style.icon}</span>
    <p class="text-sm leading-snug">${message}</p>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.remove('translate-x-[110%]', 'opacity-0'));
  setTimeout(() => { el.classList.add('translate-x-[110%]', 'opacity-0'); setTimeout(() => el.remove(), 300); }, duration);
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.querySelector('[data-modal-panel]')?.classList.remove('scale-95', 'opacity-0'));
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.querySelector('[data-modal-panel]')?.classList.add('scale-95', 'opacity-0');
  setTimeout(() => modal.classList.add('hidden'), 150);
}

document.addEventListener('click', (e) => {
  const closeTrigger = e.target.closest('[data-close-modal]');
  if (closeTrigger) closeModal(closeTrigger.closest('[data-modal]')?.id);
});

export function initSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!toggle || !sidebar) return;
  const open = () => { sidebar.classList.remove('-translate-x-full'); overlay?.classList.remove('hidden'); };
  const close = () => { sidebar.classList.add('-translate-x-full'); overlay?.classList.add('hidden'); };
  toggle.addEventListener('click', () => sidebar.classList.contains('-translate-x-full') ? open() : close());
  overlay?.addEventListener('click', close);
}

export function skeletonRows(count = 3, heightClass = 'h-16') {
  return Array.from({ length: count })
    .map(() => `<div class="animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800 ${heightClass}"></div>`).join('');
}

export function emptyState({ icon = '🧾', title, subtitle, actionLabel, actionHref }) {
  return `
    <div class="flex flex-col items-center justify-center text-center py-14 px-6">
      <div class="text-4xl mb-3">${icon}</div>
      <h3 class="font-semibold text-slate-700 dark:text-slate-200">${title}</h3>
      ${subtitle ? `<p class="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">${subtitle}</p>` : ''}
      ${actionLabel ? `<a href="${actionHref || '#'}" class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors">${actionLabel}</a>` : ''}
    </div>`;
}

export function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const val = Math.floor(diff / secs);
    if (val >= 1) return `${val} ${name}${val > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('');
}

export function formatMoney(amount, currency = 'GHS') {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency }).format(Number(amount || 0));
}
