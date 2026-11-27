import type { Config } from './config';
import type { Point } from './sim/graph';
import type { World } from './sim/world';
import type { LotRenderer } from './render/renderer';

/** HUD, pickup tickets, toasts and the first-run help card. Plain DOM over the canvas. */
export class Hud {
  private stats = document.getElementById('stats')!;
  private tickets = document.getElementById('tickets')!;
  private toasts = document.getElementById('toasts')!;
  private modeBtn = document.getElementById('mode-btn') as HTMLButtonElement;
  private pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  private ticketEls = new Map<number, HTMLElement>();
  private badgeLayer = document.getElementById('badges')!;
  private badgePool: HTMLElement[] = [];
  paused = false;

  constructor(private cfg: Config, private world: () => World, private view: () => LotRenderer, handlers: { restart: () => void; tune: () => void }) {
    this.modeBtn.addEventListener('click', () => {
      const order = ['queue', 'tap', 'draw'] as const;
      cfg.controls.valetMode = order[(order.indexOf(cfg.controls.valetMode) + 1) % order.length];
      this.view().pendingCar = null;
      this.refreshMode();
    });
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    document.getElementById('restart-btn')!.addEventListener('click', handlers.restart);
    document.getElementById('tune-btn')!.addEventListener('click', handlers.tune);
    const help = document.getElementById('help')!;
    document.getElementById('help-btn')!.addEventListener('click', () => help.classList.toggle('hidden'));
    help.addEventListener('click', () => help.classList.add('hidden'));
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); this.togglePause(); } });
    this.refreshMode();
  }

  togglePause() {
    this.paused = !this.paused;
    this.pauseBtn.textContent = this.paused ? '▶' : '❚❚';
  }

  refreshMode() {
    const names = { queue: 'Valets: Queue', tap: 'Valets: Tap', draw: 'Valets: Draw' } as const;
    this.modeBtn.textContent = names[this.cfg.controls.valetMode];
  }

  reset() {
    this.tickets.innerHTML = '';
    this.ticketEls.clear();
  }

  toast(text: string, tone: 'good' | 'bad' | 'info', at?: Point) {
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.textContent = text;
    if (at) {
      const s = this.view().worldToScreen(at);
      el.classList.add('float');
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      document.body.appendChild(el);
    } else {
      this.toasts.appendChild(el);
    }
    setTimeout(() => el.remove(), 1800);
  }

  /** Numbered order badges on queued cars and their target spots. */
  private updateBadges() {
    const w = this.world();
    const view = this.view();
    let used = 0;
    const badge = (x: number, z: number, text: string, color: string, outline: boolean) => {
      let el = this.badgePool[used];
      if (!el) { el = document.createElement('div'); el.className = 'badge'; this.badgeLayer.appendChild(el); this.badgePool.push(el); }
      used++;
      const s = view.worldToScreen({ x, z });
      el.style.display = 'flex';
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      el.textContent = text;
      el.style.background = outline ? 'rgba(20,22,26,0.75)' : color;
      el.style.borderColor = color;
      el.style.color = outline ? color : '#fff';
    };
    // Orders a valet is on: valet color. Orders waiting for a free valet: numbered in line order.
    for (const v of w.valets) {
      if (!v.current || v.state === 'inCar') continue;
      const color = view.valetColor(v.id);
      const car = w.cars.get(v.current.carId);
      if (car) badge(car.x, car.z, '→', color, false);
      const d = w.lot.nodes[v.current.dest];
      badge(d.x, d.z, '→', color, true);
    }
    const neutral = '#8a93a0';
    w.orders.forEach((o, i) => {
      const car = w.cars.get(o.carId);
      if (car) badge(car.x, car.z, String(i + 1), neutral, false);
      const d = w.lot.nodes[o.dest];
      badge(d.x, d.z, String(i + 1), neutral, true);
    });
    for (let i = used; i < this.badgePool.length; i++) this.badgePool[i].style.display = 'none';
  }

  update() {
    this.updateBadges();
    const w = this.world();
    const s = w.stats;
    const free = w.lot.stalls.filter((id) => w.lot.nodes[id].occupant === null).length;
    this.stats.innerHTML =
      `<b>$${s.tips}</b> tips · ${s.served} served · ${s.lost} lost · ${s.wrongKeys} wrong keys` +
      ` · ${free}/${w.lot.stalls.length} stalls free${w.queue ? ` · <span class="warn">${w.queue} waiting on the street</span>` : ''}` +
      ` · <span class="dim">seed ${w.seed}</span>`;

    // Pickup tickets: oldest first.
    const live = [...w.tickets.values()].sort((a, b) => b.age - a.age);
    const ids = new Set(live.map((t) => t.id));
    for (const [id, el] of this.ticketEls) if (!ids.has(id)) { el.remove(); this.ticketEls.delete(id); }
    for (const t of live) {
      let el = this.ticketEls.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'ticket';
        el.innerHTML = `<div class="t-label">PICKUP</div><div class="t-desc"></div><div class="t-bar"><i></i></div>`;
        el.querySelector('.t-desc')!.textContent = t.description;
        this.tickets.appendChild(el);
        this.ticketEls.set(t.id, el);
      }
      const left = Math.max(0, 1 - t.age / t.patience);
      const bar = el.querySelector('.t-bar i') as HTMLElement;
      bar.style.width = `${left * 100}%`;
      el.classList.toggle('angry', t.angry);
      el.classList.toggle('urgent', !t.angry && left < 0.33);
    }
    // Keep DOM order matching urgency.
    live.forEach((t) => this.tickets.appendChild(this.ticketEls.get(t.id)!));
    if (!live.length) {
      if (!this.tickets.querySelector('.empty')) this.tickets.insertAdjacentHTML('beforeend', '<div class="empty">No pickups yet</div>');
    } else {
      this.tickets.querySelector('.empty')?.remove();
    }
  }
}
