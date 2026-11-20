import {button, div, h4, hr, VNode} from "@cycle/dom";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {credentialAvailability} from "../../../credentials";
import {sideButtons} from "./buttons";
import {ifdocoSection} from "./ifdocoView";
import {State} from "./index";
import {numberInput} from "./numberInput";
import {canClearPosition} from "./request";
import {sizeSection} from "./sizeView";
import {stopSection} from "./stopView";
import {twapSection} from "./twapView";
import {isValidLimitOrder, isValidOrderSize} from "./validation";

export const view = (state$: Stream<State>): Stream<VNode> =>
    Stream.combine(state$.compose(dropRepeats(sameViewInputs)), credentialAvailability()).map(([state, canSign]) =>
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
    && previous.positionCredentialVersion === next.positionCredentialVersion
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
    && Object.is(previous.twap.totalSlices, next.twap.totalSlices)
    && clearOrderButtonDisabled(previous) === clearOrderButtonDisabled(next);

const marketSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Market"),
        div(".market-order-buttons.order-buttons", sideButtons(state.isOrdering || !isValidOrderSize(state))),
    ]);

const limitSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Limit"),
        div(".limit-order-buttons.order-buttons", [
            numberInput("#price-input", state.price),
            ...sideButtons(state.isOrdering || !isValidLimitOrder(state)),
        ]),
    ]);

const clearSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Clear position"),
        div(".order-buttons", [
            button(
                ".clear-button",
                { attrs: { disabled: !canClearPosition(state) } },
                "Clear Position",
            ),
            button(".clear-order-button", { attrs: { disabled: clearOrderButtonDisabled(state) } }, "Clear Orders"),
        ]),
    ]);

const clearOrderButtonDisabled = (state: State): boolean =>
    state.isOrdering || (state.orders.length + Object.keys(state.parentStopOrders).length) === 0;
