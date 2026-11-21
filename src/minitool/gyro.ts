type Frame = { x: number; y: number; z: number };
type Launch = { miniToolEnv?: { buildVersion?: number | string } };
type NativeGyro = {
  getLaunchOptions?(): Promise<Launch>;
  onGyroscopeChange(fn: (frame: Frame) => void): void;
  offGyroscopeChange(fn: (frame: Frame) => void): void;
  startGyroscope(options: { interval: 'ui' }): Promise<unknown>;
  stopGyroscope(): Promise<unknown>;
};
type Platform = { launchOptions?: Launch; miniTool?: Partial<NativeGyro> };

function clientVersion(options?: Launch) {
  const value = options?.miniToolEnv?.buildVersion;
  if (!/^[1-9]\d{6,}$/.test(String(value))) return 0;
  const n = Number(value);
  return Number.isSafeInteger(n) ? Math.floor(n / 1000) : 0;
}

async function supportedHost(platform?: Platform): Promise<NativeGyro | undefined> {
  const host = platform?.miniTool;
  if (!host || typeof host.startGyroscope !== 'function' || typeof host.stopGyroscope !== 'function' ||
      typeof host.onGyroscopeChange !== 'function' || typeof host.offGyroscopeChange !== 'function') return;
  let version = clientVersion(platform?.launchOptions);
  if (!version && typeof host.getLaunchOptions === 'function') {
    try { version = clientVersion(await host.getLaunchOptions()); } catch { return; }
  }
  return version >= 9500 ? host as NativeGyro : undefined;
}

/** Bind one opt-in sensor button. Forward frame deltas in seconds to tick via the engine's onTick. */
export function bindGyro(button: HTMLButtonElement, look: (yaw: number, pitch: number) => void, message?: (text: string) => void) {
  const platform = (window as Window & { xhs?: Platform }).xhs;
  let host: NativeGyro | undefined;
  let active = false, wanted = false, busy = false, disposed = false, subscribed = false;
  let yaw = 0, pitch = 0, lastSample = -Infinity;
  let pending: Promise<void> = Promise.resolve();
  button.type = 'button';
  button.hidden = true;
  button.title = '体感环顾';
  button.setAttribute('aria-label', '体感环顾');
  button.setAttribute('aria-pressed', 'false');

  const ready = supportedHost(platform).then(result => {
    host = result;
    if (!disposed) button.hidden = !host;
  });

  function sample(frame: Frame) {
    if (!wanted || document.hidden) return;
    if (!Number.isFinite(frame?.x) || !Number.isFinite(frame?.y)) {
      lastSample = -Infinity;
      return;
    }
    // Rotate device rates into screen axes. Rates are radians per second.
    const rotation = window.screen.orientation?.angle ?? (Number(window.orientation) || 0);
    const quarter = ((Math.round(rotation / 90) % 4) + 4) % 4;
    const { x, y } = frame;
    yaw = quarter === 0 ? y : quarter === 1 ? x : quarter === 2 ? -y : -x;
    pitch = quarter === 0 ? x : quarter === 1 ? -y : quarter === 2 ? -x : y;
    if (Math.abs(yaw) < 0.025) yaw = 0;
    if (Math.abs(pitch) < 0.025) pitch = 0;
    lastSample = performance.now();
  }

  function detach() {
    lastSample = -Infinity;
    if (subscribed) {
      host!.offGyroscopeChange(sample);
      subscribed = false;
    }
  }

  function render() {
    button.disabled = busy;
    button.setAttribute('aria-pressed', String(active && wanted));
  }

  async function stopSensor(announce = false) {
    try {
      await host!.stopGyroscope();
      if (announce && !document.hidden && !disposed) message?.('体感关了，拖动环顾');
    }
    catch { if (!document.hidden && !disposed) message?.('体感关闭失败，请重试'); }
    finally { active = false; }
  }

  function stop(announce = false) {
    wanted = false;
    detach();
    if (busy || !active) { render(); return pending; }
    busy = true;
    render();
    pending = stopSensor(announce).then(() => { busy = false; render(); });
    return pending;
  }

  function toggle() {
    if (!host || busy || disposed || document.hidden) return;
    if (active) {
      void stop(true);
      return;
    }
    busy = true;
    wanted = true;
    render();
    pending = (async () => {
      try {
        host!.onGyroscopeChange(sample);
        subscribed = true;
        await host!.startGyroscope({ interval: 'ui' });
        active = true;
        // The user may have left for another sheet or backgrounded the app during startup.
        if (!wanted || disposed || document.hidden) await stopSensor();
        else message?.('转动手机，四处看看');
      } catch (error) {
        wanted = false;
        detach();
        if (Number((error as { errCode?: number } | null)?.errCode) === 10002) button.hidden = true;
        if (!document.hidden && !disposed) message?.('体感不可用，可拖动环顾');
      } finally { busy = false; render(); }
    })();
  }

  function onPageHide() { void stop(); }
  function onVisibility() { if (document.hidden) void stop(); }
  button.addEventListener('click', toggle);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  return {
    ready,
    tick(dt: number) {
      // A paused or interrupted event stream must not keep turning the camera.
      if (active && wanted && !document.hidden && performance.now() - lastSample < 250 && dt > 0 && Number.isFinite(dt)) {
        const step = Math.min(dt, 0.05);
        look(yaw * step, pitch * step);
      }
    },
    stop,
    dispose() {
      disposed = true;
      button.hidden = true;
      button.removeEventListener('click', toggle);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      return stop();
    },
  };
}
