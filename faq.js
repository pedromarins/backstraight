import { setLocale, applyTranslations } from './i18n.mjs';

// Load locale
window.config.get().then(cfg => {
  if (cfg.locale) setLocale(cfg.locale);
  applyTranslations();
});

// Accordion toggle
document.querySelectorAll('.faq-question').forEach(q => {
  q.addEventListener('click', () => {
    const item = q.parentElement;
    item.classList.toggle('open');
  });
});
