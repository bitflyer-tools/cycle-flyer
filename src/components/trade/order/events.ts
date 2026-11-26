import {DOMSource, MainDOMSource} from "@cycle/dom";
import {Stream} from "xstream";

export const clicks = (dom: DOMSource, container: string, selector: string): Stream<null> =>
    (dom as MainDOMSource).select(container).select(selector)
        .events("click", { preventDefault: true })
        .mapTo(null);

export const numberInputs = (dom: DOMSource, selector: string): Stream<number> =>
    textInputs(dom, selector).map((value) => +value);

export const textInputs = (dom: DOMSource, selector: string): Stream<string> =>
    (dom as MainDOMSource).select(selector)
        .events("input")
        .map((event: Event) => event.target as HTMLInputElement)
        .map((element: HTMLInputElement) => element.value);

export const sizePresetClicks = (dom: DOMSource): Stream<number> =>
    (dom as MainDOMSource).select(".size-presets").select(".size-preset")
        .events("click", { preventDefault: true })
        .map((event: Event) => event.currentTarget as HTMLElement)
        .map((element: HTMLElement) => +(element.dataset.size || 0));
