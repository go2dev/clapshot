/**
 * FolderListing.svelte on touch devices.
 *
 * Touch browsers never synthesize `dblclick` from a double tap, so the desktop
 * "double-click to open" gesture is unreachable there. These tests cover the
 * `tapToOpen` action: a single short tap opens an item, while scroll-like moves
 * and long presses (which belong to svelte-dnd-action's press-and-hold drag) do not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import FolderListing from '@/lib/asset_browser/FolderListing.svelte';
import { selectedTiles } from '@/stores';
import { VideoListDefItem } from '@/lib/asset_browser/types';
import { createMinimalMediaFile, createFolderListingItem } from '../../mocks/protobuf-factories';

function makeItem(id: string): VideoListDefItem {
  return {
    id,
    obj: createFolderListingItem({
      mediaFile: createMinimalMediaFile({ id, title: `Video ${id}` }),
      openAction: { lang: 'javascript', code: 'open' } as any,
      popupActions: [],
    }),
  };
}

// happy-dom has no real Touch objects; build touch events by hand with the few
// fields the component reads (touches / changedTouches with clientX/clientY).
function touchEvent(type: string, touches: {x: number, y: number}[], changed: {x: number, y: number}[]) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const conv = (t: {x: number, y: number}) => ({ clientX: t.x, clientY: t.y });
  Object.defineProperty(ev, 'touches', { value: touches.map(conv) });
  Object.defineProperty(ev, 'changedTouches', { value: changed.map(conv) });
  return ev;
}

function tap(el: Element, from: {x: number, y: number}, to = from) {
  el.dispatchEvent(touchEvent('touchstart', [from], [from]));
  const end = touchEvent('touchend', [], [to]);
  el.dispatchEvent(end);
  return end;
}

describe('FolderListing touch: tap to open', () => {
  let openItem: ReturnType<typeof vi.fn>;
  let now: ReturnType<typeof vi.spyOn>;

  function renderListing(dragDisabled = true) {
    openItem = vi.fn();
    const items = [makeItem('v1'), makeItem('v2')];
    render(FolderListing, {
      props: { listingData: { folder: 'f1' }, items, dragDisabled },
      events: { 'open-item': openItem },
    } as any);
    return items;
  }

  beforeEach(() => {
    selectedTiles.set({});
    global.alert = vi.fn();
    // Deterministic clock for the tap-duration check
    let t = 1000;
    now = vi.spyOn(performance, 'now').mockImplementation(() => t);
    (globalThis as any).__advance = (ms: number) => { t += ms; };
  });

  afterEach(() => {
    now.mockRestore();
    cleanup();
  });

  it('opens the tapped item on a short single tap', () => {
    const items = renderListing();
    const tile = document.getElementById('videolist_item__v2')!;
    selectedTiles.set({ v1: items[0] });

    const end = tap(tile, { x: 100, y: 100 }, { x: 103, y: 98 });

    expect(openItem).toHaveBeenCalledTimes(1);
    const detail = openItem.mock.calls[0][0].detail;
    expect(detail.item.mediaFile.id).toBe('v2');
    expect(detail.listingData).toEqual({ folder: 'f1' });
    // The browser's follow-up mouse events / double-tap zoom are suppressed...
    expect(end.defaultPrevented).toBe(true);
    // ...and opening clears the selection, like Enter / double-click do.
    expect(get(selectedTiles)).toEqual({});
  });

  it('still opens on tap when drag & drop is enabled', () => {
    renderListing(false);
    tap(document.getElementById('videolist_item__v1')!, { x: 50, y: 50 });
    expect(openItem).toHaveBeenCalledTimes(1);
    expect(openItem.mock.calls[0][0].detail.item.mediaFile.id).toBe('v1');
  });

  it('does not open when the finger moved (scroll gesture)', () => {
    renderListing();
    const end = tap(document.getElementById('videolist_item__v1')!, { x: 100, y: 100 }, { x: 100, y: 160 });
    expect(openItem).not.toHaveBeenCalled();
    expect(end.defaultPrevented).toBe(false);
  });

  it('does not open on a long press (reserved for press-and-hold drag)', () => {
    renderListing();
    const tile = document.getElementById('videolist_item__v1')!;
    tile.dispatchEvent(touchEvent('touchstart', [{ x: 10, y: 10 }], [{ x: 10, y: 10 }]));
    (globalThis as any).__advance(600);
    const end = touchEvent('touchend', [], [{ x: 10, y: 10 }]);
    tile.dispatchEvent(end);
    expect(openItem).not.toHaveBeenCalled();
    expect(end.defaultPrevented).toBe(false);
  });

  it('ignores multi-finger touches', () => {
    renderListing();
    const tile = document.getElementById('videolist_item__v1')!;
    tile.dispatchEvent(touchEvent('touchstart', [{ x: 10, y: 10 }, { x: 40, y: 10 }], [{ x: 10, y: 10 }]));
    tile.dispatchEvent(touchEvent('touchend', [], [{ x: 10, y: 10 }]));
    expect(openItem).not.toHaveBeenCalled();
  });

  it('ignores a touchend that follows touchcancel', () => {
    renderListing();
    const tile = document.getElementById('videolist_item__v1')!;
    tile.dispatchEvent(touchEvent('touchstart', [{ x: 10, y: 10 }], [{ x: 10, y: 10 }]));
    tile.dispatchEvent(new Event('touchcancel', { bubbles: true }));
    tile.dispatchEvent(touchEvent('touchend', [], [{ x: 10, y: 10 }]));
    expect(openItem).not.toHaveBeenCalled();
  });

  it('keeps mouse behaviour: a single click selects, it does not open', async () => {
    const items = renderListing();
    const tile = document.getElementById('videolist_item__v1')!;
    await fireEvent.mouseUp(tile, { button: 0 });
    expect(openItem).not.toHaveBeenCalled();
    expect(Object.keys(get(selectedTiles))).toEqual(['v1']);
    await fireEvent.dblClick(tile);
    expect(openItem).toHaveBeenCalledTimes(1);
    expect(openItem.mock.calls[0][0].detail.item).toBe(items[0].obj);
  });
});
