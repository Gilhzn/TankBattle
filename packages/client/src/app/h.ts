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

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class' || key === 'className') el.className = String(value);
      else if (key === 'style') {
        if (typeof value === 'string') el.style.cssText = value;
        else Object.assign(el.style, value);
      } else if (key === 'dataset') {
        for (const [k, v] of Object.entries(value as Record<string, string>)) el.dataset[k] = v;
      } else if (key === 'attrs') {
        for (const [k, v] of Object.entries(value as Record<string, string | number | boolean | undefined>)) {
          if (v === undefined || v === false) continue;
          el.setAttribute(k, v === true ? '' : String(v));
        }
      } else if (key === 'ref') (value as (el: HTMLElement) => void)(el);
      else if (key === 'html') el.innerHTML = String(value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key in el) {
        (el as unknown as Record<string, unknown>)[key] = value;
      } else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}
