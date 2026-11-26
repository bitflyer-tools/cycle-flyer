import {input, VNode} from "@cycle/dom";

export const numberInput = (selector: string, value: number): VNode =>
    input(selector, {
        attrs: { value },
        hook: { update: (_: VNode, vnode: VNode) => syncValue(vnode.elm as HTMLInputElement, value) },
    });

export const syncValue = (element: HTMLInputElement, value: number) => {
    if (element !== document.activeElement && +element.value !== value) { element.value = value.toString(); }
};
