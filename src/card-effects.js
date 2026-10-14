const initialized = new WeakSet();

export function initializeCardEffects() {
  const pointer = matchMedia('(hover:hover) and (pointer:fine)');
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  document.querySelectorAll('.metric-card, .panel, .receivable-card').forEach(card => {
    if (initialized.has(card)) return;
    initialized.add(card);
    let frame;
    card.addEventListener('pointermove', event => {
      if (!pointer.matches || reduced.matches || event.pointerType === 'touch') return;
      cancelAnimationFrame(frame);
      const x = event.clientX, y = event.clientY;
      frame = requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        const px = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
        const py = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
        card.style.setProperty('--mx', `${px * 100}%`);
        card.style.setProperty('--my', `${py * 100}%`);
        // Tilt overview cards only; form fields and table rows stay steady.
        if (card.classList.contains('metric-card')) {
          card.style.setProperty('--rx', `${(.5 - py) * 2}deg`);
          card.style.setProperty('--ry', `${(px - .5) * 2}deg`);
        }
      });
    });
    card.addEventListener('pointerleave', () => {
      cancelAnimationFrame(frame);
      card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg');
    });
  });
}
