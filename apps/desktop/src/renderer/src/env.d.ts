import type { DesktopApi } from '../../shared.js';

declare global {
  interface Window {
    skillink: DesktopApi;
  }
}

export {};
