import { $, motion } from './util.js';

export function initScroller(wrap) {
  const row = $('.scroll-row', wrap);
  const prev = $('.prev', wrap);
  const next = $('.next', wrap);
  let raf = null;

  const update = () => {
    const max = row.scrollWidth - row.clientWidth;
    wrap.classList.toggle('can-left', row.scrollLeft > 2);
    wrap.classList.toggle('can-right', row.scrollLeft < max - 2);
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    raf = null;
    prev.classList.remove('is-gliding');
    next.classList.remove('is-gliding');
  };

  const glide = (dir, btn) => {
    stop();
    btn.classList.add('is-gliding');
    const start = performance.now();
    let last = start;
    const tick = (now) => {
      const speed = 0.3 + Math.min((now - start) / 600, 1) * 0.7;
      row.scrollLeft += dir * (now - last) * speed;
      last = now;
      const max = row.scrollWidth - row.clientWidth;
      if ((dir < 0 && row.scrollLeft <= 0) || (dir > 0 && row.scrollLeft >= max - 1)) {
        stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  [[prev, -1], [next, 1]].forEach(([btn, dir]) => {
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') glide(dir, btn); });
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('click', () => {
      // A mouse click lands mid-glide; only touch and keyboard need the jump.
      if (raf) return;
      row.scrollBy({ left: dir * row.clientWidth * 0.75, behavior: motion() });
    });
  });

  row.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(row);
  new MutationObserver(update).observe(row, { childList: true });

  if (wrap.hasAttribute('data-wheel')) {
    row.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    }, { passive: false });
  }
}
