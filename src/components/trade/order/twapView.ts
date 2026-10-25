import {button, div, h4, label, p, VNode} from "@cycle/dom";
import {canStart, isRunning, sliceSize} from "../../../models/twapOrder";
import {State} from "./index";
import {numberInput} from "./numberInput";

export const twapSection = (state: State): VNode =>
    div([
        h4(".sub-title", "TWAP"),
        div(".twap-slices", [
            label(".label", "Slices"),
            numberInput("#twap-slices-input", state.twap.slices),
        ]),
        div(".twap-interval", [
            label(".label", "Interval (sec)"),
            numberInput("#twap-interval-input", state.twap.interval),
        ]),
        p(".twap-status", twapStatus(state)),
        div(".twap-order-buttons.order-buttons", twapButtons(state)),
    ]);

const twapStatus = (state: State): string =>
    isRunning(state.twap)
        ? `Running: ${state.twap.remaining} / ${state.twap.slices} slices left`
        : `${sliceSize(state.size, state.twap.slices)} x ${state.twap.slices} every ${state.twap.interval} sec`;

const twapButtons = (state: State): VNode[] =>
    isRunning(state.twap)
        ? [button(".cancel-button", "Cancel TWAP")]
        : [
            button(".sell-button", { attrs: { disabled: !canStart(state.twap, state.size) } }, "Sell"),
            button(".buy-button", { attrs: { disabled: !canStart(state.twap, state.size) } }, "Buy"),
        ];
