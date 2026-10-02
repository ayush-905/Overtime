// One tooltip for the whole page: anything with a data-tip shows it on hover.

export function initTooltip(tip) {
  let current = null;
  const place = (e) => {
    const pad = 12;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  };
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (target === current) return;
    current = target;
    if (!target) {
      tip.hidden = true;
      return;
    }
    // A dialog open over the page sits above everything else, so the tip goes inside it.
    const host = target.closest('dialog[open]') || document.body;
    if (tip.parentElement !== host) host.append(tip);
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    place(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (current && !current.isConnected) {
      current = null;
      tip.hidden = true;
    } else if (current) place(e);
  });
}
