import {button, div, h4, label, p, VNode} from "@cycle/dom";
import {allocateSlices, canStart, isRunning, maximumTwapInterval} from "../../../models/twapOrder";
import {State} from "./index";
import {numberInput} from "./numberInput";

export const twapSection = (state: State, canSign: boolean): VNode =>
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
        p(".twap-interval-hint", `Enter an interval greater than 0 and up to ${maximumTwapInterval} seconds.`),
        p(".twap-status", { attrs: { role: "status" } }, twapStatus(state, canSign)),
        ...(isRunning(state.twap) ? [p(".twap-status", "Schedule edits apply to the next TWAP.")] : []),
        div(".twap-order-buttons.order-buttons", twapButtons(state, canSign)),
    ]);

const twapStatus = (state: State, canSign: boolean): string =>
    isRunning(state.twap)
        ? `Running: ${state.twap.remaining} / ${state.twap.totalSlices} slices left`
        : state.twap.error || (!canSign ? "Configure bitFlyer credentials in Settings to start TWAP." :
            twapPreview(state));

const twapPreview = ({ size, twap }: State): string => {
    const { baseSize, largerSize, largerCount } = allocateSlices(size, twap.slices);
    const largerSlices = largerCount > 0 ? `${largerSize} x ${largerCount} + ` : "";
    return `${largerSlices}${baseSize} x ${twap.slices - largerCount} every ${twap.interval} sec`;
};

const twapButtons = (state: State, canSign: boolean): VNode[] =>
    isRunning(state.twap)
        ? [button(".cancel-button", "Cancel TWAP")]
        : [
            button(".sell-button",
                { attrs: { disabled: !canSign || !canStart(state.twap, state.size, state.accountType) } }, "Sell"),
            button(".buy-button",
                { attrs: { disabled: !canSign || !canStart(state.twap, state.size, state.accountType) } }, "Buy"),
        ];
