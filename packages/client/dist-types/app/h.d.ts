/** Tiny DOM helper: h(tag, props, ...children). No virtual DOM — screens rebuild what they need. */
export type Child = Node | string | number | null | undefined | false | Child[];
export type Props = {
    class?: string;
    className?: string;
    id?: string;
    style?: string | Partial<CSSStyleDeclaration>;
    dataset?: Record<string, string>;
    attrs?: Record<string, string | number | boolean | undefined>;
    ref?: (el: HTMLElement) => void;
    html?: string;
    [key: string]: unknown;
};
export declare function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K];
export declare function append(el: Node, children: Child[]): void;
export declare function clear(el: Element): void;
export declare function frag(...children: Child[]): DocumentFragment;
//# sourceMappingURL=h.d.ts.map