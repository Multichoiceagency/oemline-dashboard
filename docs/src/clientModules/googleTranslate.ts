/**
 * Client module that injects the Google Translate widget into the navbar
 * after the page has loaded and the translate element has been initialised.
 */

function moveTranslateWidget(): void {
  const source = document.getElementById('google_translate_element');
  if (!source) return;

  // Look for the right side of the navbar
  const navbarRight = document.querySelector('.navbar__items--right');
  if (!navbarRight) return;

  // Only inject once
  if (navbarRight.querySelector('.google-translate-container')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'google-translate-container';
  wrapper.appendChild(source);
  source.style.display = 'block';

  // Insert before the last item (e.g. the GitHub link)
  navbarRight.insertBefore(wrapper, navbarRight.firstChild);
}

// Run on every client-side navigation (Docusaurus SPA)
if (typeof window !== 'undefined') {
  const observer = new MutationObserver(() => {
    moveTranslateWidget();
  });

  function init(): void {
    observer.observe(document.body, {childList: true, subtree: true});
    // Also try immediately in case the element already exists
    moveTranslateWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

export {};
