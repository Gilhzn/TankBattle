import { type CatalogItem } from '@tank/shared';
import { type Child } from '../app/h.js';
export interface ScreenShell {
    el: HTMLElement;
    body: HTMLElement;
    header: HTMLElement;
}
/** Standard screen chrome: sticky glass header with back button + title, scrollable body. */
export declare function screenShell(title: string, opts?: {
    back?: string;
    right?: Child;
    testid?: string;
    className?: string;
}): ScreenShell;
export declare function button(label: Child, opts?: {
    kind?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
    testid?: string;
    onClick?: (e: MouseEvent) => void;
    disabled?: boolean;
    className?: string;
    big?: boolean;
    type?: 'button' | 'submit';
}): HTMLButtonElement;
export declare function panel(...children: Child[]): HTMLElement;
export declare function tabs<T extends string>(items: Array<{
    id: T;
    label: string;
    testid?: string;
}>, active: T, onChange: (id: T) => void): HTMLElement;
export interface Modal {
    el: HTMLElement;
    close: () => void;
}
export declare function modal(content: Child, opts?: {
    testid?: string;
    onClose?: () => void;
    dismissible?: boolean;
}): Modal;
export declare function spinner(): HTMLElement;
export declare function emptyState(text: string): HTMLElement;
export declare function offlineNotice(text?: string): HTMLElement;
/** Coins / gems chip bound to the store. Returns an element that updates itself; call the returned cleanup on unmount. */
export declare function walletChip(): {
    el: HTMLElement;
    dispose: () => void;
};
export declare function priceText(item: CatalogItem, currency: 'coins' | 'gems' | 'usd'): string;
export declare function itemIcon(sku: string, size?: 'sm' | 'lg'): HTMLElement;
export declare function displayName(sku: string): string;
/** Live canvas preview of a tank drawn in a skin (used in the garage / store / menu). */
export declare function tankPreview(skin: string, cssSize: number, opts?: {
    animate?: boolean;
    tier?: number;
}): HTMLCanvasElement;
export declare function rewardLabel(r: {
    coins?: number;
    gems?: number;
    items?: Record<string, number>;
} | null | undefined): string;
export declare function rewardIcon(r: {
    coins?: number;
    gems?: number;
    items?: Record<string, number>;
} | null | undefined): HTMLElement;
/** Mounted once; renders app.toasts. */
export declare function toastHost(): HTMLElement;
export declare function formatDuration(ms: number): string;
export declare function labelled(label: string, control: Child, hint?: string): HTMLElement;
export declare function toggle(checked: boolean, onChange: (v: boolean) => void, testid?: string): HTMLElement;
//# sourceMappingURL=components.d.ts.map