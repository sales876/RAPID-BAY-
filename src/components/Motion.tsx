'use client';

import { useEffect } from 'react';

/**
 * Drives the CSS motion layer in globals.css. Nothing here renders markup —
 * it only marks elements, so a failure to run leaves the UI fully visible and
 * fully usable rather than stuck mid-animation.
 *
 * State is written as data attributes rather than classes because React owns
 * `className` on most of these nodes and rewrites it whenever a job's status
 * changes, which would silently strip a class we had added.
 */

/** Structural containers worth revealing. Live rows (job/worker cards, table
 *  rows) are deliberately excluded — they churn constantly on a running floor,
 *  and animating them would fight the operator rather than help them. */
const REVEAL_TARGETS = 'section, .card, .banner, .stage-card';
const SCROLL_THRESHOLD_PX = 16;
const MAX_STAGGER_STEPS = 7;

function isExcluded(el: Element) {
  return Boolean(el.closest('.modal, [role="dialog"], [aria-live]'));
}

export function MotionProvider() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---- Scroll reveal -------------------------------------------------- */
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Reveal on entry, but also for anything that has already gone past
          // above the fold — a restored scroll position or a jump to an anchor
          // can skip an element entirely, and it must not stay invisible.
          const scrolledPast = entry.boundingClientRect.bottom <= 0;
          if (!entry.isIntersecting && !scrolledPast) continue;
          entry.target.setAttribute('data-revealed', '');
          observer.unobserve(entry.target); // once only
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );

    const tagged = new WeakSet<Element>();

    /**
     * The entrance pass. Once it closes, content that mounts *already on
     * screen* is shown immediately instead of being hidden and faded back in.
     *
     * This matters because the live queue re-renders every second as timers
     * tick, and React replaces the card's DOM node when it does. Hiding each
     * replacement would restart an 850ms fade that never gets to finish, and
     * the card would sit permanently invisible on a running floor.
     */
    let entranceOpen = true;
    let entranceTimer = 0;

    /* The window opens when content first arrives, not when this effect runs.
       Pages here authenticate and fetch before rendering anything, so a timer
       started at mount would expire against an empty page and every real
       element would then count as "already on screen". */
    const startEntranceCountdown = () => {
      if (entranceTimer) return;
      entranceTimer = window.setTimeout(() => { entranceOpen = false; }, 600);
    };

    const isOnScreen = (el: Element) => {
      const { top, bottom } = el.getBoundingClientRect();
      return bottom > 0 && top < window.innerHeight;
    };

    /** Whether this element should animate at all. Anything that appears
     *  already on screen after the entrance pass is left completely alone —
     *  marking it hidden and fading it back in is what made the live queue
     *  flicker, and enrolling it at all is what caused that. */
    const shouldAnimate = (el: Element) => !reduced && (entranceOpen || !isOnScreen(el));

    const scan = () => {
      const roots = document.querySelectorAll('.content, .staff-body');
      for (const root of roots) {
        const found = root.querySelectorAll(REVEAL_TARGETS);
        if (found.length) startEntranceCountdown();
        let index = 0;
        for (const el of found) {
          if (tagged.has(el) || isExcluded(el)) continue;
          tagged.add(el);
          if (!shouldAnimate(el)) continue;
          el.setAttribute('data-reveal', '');
          el.setAttribute('data-reveal-i', String(Math.min(index, MAX_STAGGER_STEPS)));
          index += 1;
          observer.observe(el);
        }
      }

      for (const el of document.querySelectorAll('.headline-mask')) {
        if (tagged.has(el)) continue;
        tagged.add(el);
        if (!shouldAnimate(el)) {
          el.setAttribute('data-revealed', '');
          continue;
        }
        observer.observe(el);
      }
    };

    scan();

    // Pages here render client-side, so most content arrives after mount.
    const mutations = new MutationObserver(() => scan());
    mutations.observe(document.body, { childList: true, subtree: true });

    /* ---- Sticky header elevation ---------------------------------------- */
    let frame = 0;
    const applyStuck = () => {
      frame = 0;
      const stuck = window.scrollY > SCROLL_THRESHOLD_PX;
      for (const header of document.querySelectorAll('.topbar, .staff-top')) {
        if (stuck) header.setAttribute('data-stuck', '');
        else header.removeAttribute('data-stuck');
      }
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(applyStuck);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    applyStuck();

    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(entranceTimer);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}

/**
 * A heading that rises out of an overflow-hidden mask. Each child is one line
 * and staggers after the one above it.
 */
export function Headline({
  children,
  className,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'h1' | 'h2' | 'h3' | 'span';
}) {
  return (
    <span className="headline-mask">
      <Tag className={`headline-line ${className ?? ''}`.trim()}>{children}</Tag>
    </span>
  );
}
