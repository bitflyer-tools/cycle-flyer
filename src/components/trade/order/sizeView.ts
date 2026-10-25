import {button, div, h4, VNode} from "@cycle/dom";
import {State} from "./index";
import {numberInput} from "./numberInput";

export const sizePresets: number[] = [0.01, 0.05, 0.1, 0.5, 1];

export const sizeSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Size"),
        div(".size", [
            numberInput("#size-input", state.size),
        ]),
        div(".size-presets", [
            ...sizePresets.map((size) => sizePresetButton(state, size, size.toString())),
            sizePresetButton(state, Math.abs(state.position.size), "Position"),
        ]),
    ]);

const sizePresetButton = (state: State, size: number, text: string): VNode =>
    button(".size-preset", {
        attrs: { disabled: size === 0 },
        class: { selected: size !== 0 && size === state.size },
        dataset: { size: size.toString() },
    }, text);
