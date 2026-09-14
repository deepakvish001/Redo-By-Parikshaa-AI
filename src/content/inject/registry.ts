import type { Settings } from '../../core/types.ts';
import { PAGE_TOKENS } from './tokens.ts';

/**
 * The one thing that puts Redo onto a judge's page.
 *
 * Thirteen separate scripts each finding their own anchor, each attaching their
 * own observer and each writing their own CSS is how a page-enhancement
 * extension becomes unmaintainable — they fight for the same sidebar slot, they
 * re-render each other away, and one of them breaking takes the page with it.
 *
 * So features declare instead of act. A mount says which pages it wants, where
 * it attaches, and how to draw itself; the runner below owns everything else:
 * finding the anchor, waiting for it to exist, giving the mount an isolated
 * shadow root, tearing it down when the user navigates or switches it off, and
 * putting it back when the host page re-renders it away.
 */

export interface MountContext {
  /** The page the mount was matched against. */
  url: URL;
  /** The mount's own element, inside its shadow root. Draw here. */
  el: HTMLElement;
  /** Aborted when the mount goes away — hang listeners and timers on it. */
  signal: AbortSignal;
  /** Ask the runner to draw this mount again. */
  refresh(): void;
}

export interface Mount {
  /** Stable id, used for the host element and for logging. */
  id: string;
  /** True for pages this mount belongs on. */
  matches(url: URL): boolean;
  /** False when the user has switched this off. */
  enabled(settings: Settings): boolean;
  /**
   * Where the widget goes. Returning null means "not yet" — the runner will
   * try again on the next mutation, which is how it survives a page that
   * builds its sidebar after load.
   */
  anchor(): { parent: Element; position: InsertPosition } | null;
  /** Draw. Called on first mount and on every `refresh()`. */
  render(context: MountContext): void | Promise<void>;
}

interface Live {
  host: HTMLElement;
  controller: AbortController;
  /** The URL the mount was rendered for, so navigation can be detected. */
  href: string;
}

const HOST_PREFIX = 'redo-mount-';

function createHost(mount: Mount): { host: HTMLElement; el: HTMLElement } {
  const host = document.createElement('div');
  host.id = `${HOST_PREFIX}${mount.id}`;
  // The host is the wall between Redo's CSS and the judge's. Nothing inside
  // inherits from the page, and nothing inside escapes to it.
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PAGE_TOKENS;

  const el = document.createElement('div');
  shadow.append(style, el);

  return { host, el };
}

export class MountRunner {
  private readonly live = new Map<string, Live>();
  private settings: Settings | undefined;
  private observer: MutationObserver | undefined;
  private scheduled = false;

  constructor(private readonly mounts: Mount[]) {}

  /**
   * Starts watching. Safe to call before settings have loaded — mounts simply
   * stay down until `setSettings` says which are on.
   */
  start(): () => void {
    // Judges rebuild their DOM constantly while judging, and a mount removed by
    // the host page has to come back. Re-evaluating on mutation is what makes
    // that automatic instead of thirteen separate reconnection bugs.
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(document.documentElement, { childList: true, subtree: true });

    // Codeforces is server-rendered, but LeetCode and Parikshaa are not, and a
    // mount matched against the old URL must come down on navigation.
    const onNavigate = () => this.schedule();
    window.addEventListener('popstate', onNavigate);

    const originalPush = history.pushState.bind(history);
    history.pushState = ((...args: Parameters<typeof history.pushState>) => {
      originalPush(...args);
      onNavigate();
    }) as typeof history.pushState;

    this.evaluate();

    return () => {
      this.observer?.disconnect();
      window.removeEventListener('popstate', onNavigate);
      history.pushState = originalPush;
      for (const id of [...this.live.keys()]) this.unmount(id);
    };
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.evaluate();
  }

  /**
   * Mutations arrive in bursts — one submission verdict updating rewrites a
   * table row dozens of times — so evaluation is coalesced into one pass per
   * frame rather than one per mutation.
   */
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.evaluate();
    });
  }

  private evaluate(): void {
    const settings = this.settings;
    if (!settings) return;

    const url = new URL(window.location.href);
    const master = settings.page.enabled;

    for (const mount of this.mounts) {
      const wanted = master && mount.enabled(settings) && mount.matches(url);
      const existing = this.live.get(mount.id);

      if (!wanted) {
        if (existing) this.unmount(mount.id);
        continue;
      }

      // Still wanted, still attached, still the same page: leave it alone.
      if (existing?.host.isConnected && existing.href === url.href) continue;
      // The host page tore it out, or the user navigated. Either way, redraw.
      if (existing) this.unmount(mount.id);

      const spot = this.safely(mount, () => mount.anchor());
      if (!spot) continue;

      const { host, el } = createHost(mount);
      const controller = new AbortController();
      spot.parent.insertAdjacentElement(spot.position, host);
      this.live.set(mount.id, { host, controller, href: url.href });

      this.safely(mount, () =>
        mount.render({
          url,
          el,
          signal: controller.signal,
          refresh: () => {
            // A mount asking to redraw must not fight the connectivity check
            // above, so it is a real unmount-and-remount.
            this.unmount(mount.id);
            this.schedule();
          },
        }),
      );
    }
  }

  private unmount(id: string): void {
    const existing = this.live.get(id);
    if (!existing) return;
    existing.controller.abort();
    existing.host.remove();
    this.live.delete(id);
  }

  /**
   * One mount throwing must never take the page — or the other mounts — with
   * it. A judge changing its markup should cost one missing card, not a broken
   * site.
   */
  private safely<T>(mount: Mount, action: () => T): T | undefined {
    try {
      return action();
    } catch (error) {
      console.warn(`[Redo] mount "${mount.id}" failed`, error);
      return undefined;
    }
  }
}
