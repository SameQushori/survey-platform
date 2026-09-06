/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORGANIZER_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  turnstile?: {
    render(container: HTMLElement, options: {
      sitekey: string;
      action: string;
      callback(token: string): void;
      'error-callback'(): void;
      'expired-callback'(): void;
      theme?: 'light' | 'dark' | 'auto';
    }): string;
    remove(widgetId: string): void;
  };
}
