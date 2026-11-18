import {button, div, h4, hr, VNode} from "@cycle/dom";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {twapCredentialAvailability} from "../../../credentials";
import {sideButtons} from "./buttons";
import {ifdocoSection} from "./ifdocoView";
import {State} from "./index";
import {numberInput} from "./numberInput";
import {sizeSection} from "./sizeView";
import {stopSection} from "./stopView";
import {twapSection} from "./twapView";

export const view = (state$: Stream<State>): Stream<VNode> =>
    Stream.combine(state$.compose(dropRepeats(sameViewInputs)), twapCredentialAvailability()).map(([state, canSign]) =>
        div(".order", [
            ...(state.orderSigningError
                ? [div(".order-signing-error", { attrs: { role: "alert" } }, state.orderSigningError)]
                : []),
            sizeSection(state),
            hr(),
            marketSection(state),
            hr(),
            limitSection(state),
            hr(),
            stopSection(state),
            hr(),
            twapSection(state, canSign),
            hr(),
            clearSection(state),
            hr(),
            ifdocoSection(state),
        ]),
    );

const sameViewInputs = (previous: State, next: State): boolean =>
    Object.is(previous.currentPrice, next.currentPrice)
    && previous.isOrdering === next.isOrdering
    && previous.orderSigningError === next.orderSigningError
    && Object.is(previous.position.size, next.position.size)
    && Object.is(previous.price, next.price)
    && Object.is(previous.size, next.size)
    && Object.is(previous.triggerPrice, next.triggerPrice)
    && Object.is(previous.ifdocoOrder.width, next.ifdocoOrder.width)
    && Object.is(previous.ifdocoOrder.ratio, next.ifdocoOrder.ratio)
    && Object.is(previous.twap.slices, next.twap.slices)
    && Object.is(previous.twap.interval, next.twap.interval)
    && Object.is(previous.twap.remaining, next.twap.remaining)
    && previous.twap.error === next.twap.error
    && clearOrderButtonDisabled(previous) === clearOrderButtonDisabled(next);

const marketSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Market"),
        div(".market-order-buttons.order-buttons", sideButtons(orderButtonDisabled(state))),
    ]);

const limitSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Limit"),
        div(".limit-order-buttons.order-buttons", [
            numberInput("#price-input", state.price),
            ...sideButtons(orderButtonDisabled(state)),
        ]),
    ]);

const clearSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Clear position"),
        div(".order-buttons", [
            button(
                ".clear-button",
                { attrs: { disabled: state.isOrdering || state.position.size === 0 } },
                "Clear Position",
            ),
            button(".clear-order-button", { attrs: { disabled: clearOrderButtonDisabled(state) } }, "Clear Orders"),
        ]),
    ]);

const orderButtonDisabled = (state: State): boolean =>
    state.isOrdering || state.size === 0;

const clearOrderButtonDisabled = (state: State): boolean =>
    state.isOrdering || (state.orders.length + Object.keys(state.parentStopOrders).length) === 0;
