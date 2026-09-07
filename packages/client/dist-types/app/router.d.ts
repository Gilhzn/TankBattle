export type Cleanup = (() => void) | void;
export type ScreenFn = (root: HTMLElement, params: Record<string, string>) => Cleanup | Promise<Cleanup>;
export declare function route(pattern: string, name: string, screen: ScreenFn): void;
export declare function setNotFound(fn: ScreenFn): void;
export declare function currentPath(): string;
export declare function navigate(path: string, replace?: boolean): void;
export declare function render(): Promise<void>;
export declare function startRouter(el: HTMLElement): void;
//# sourceMappingURL=router.d.ts.map