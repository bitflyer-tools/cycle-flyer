import {button, div, h4, hr, VNode} from "@cycle/dom";
import Stream from "xstream";
import {sideButtons} from "./buttons";
import {ifdocoSection} from "./ifdocoView";
import {State} from "./index";
import {numberInput} from "./numberInput";
import {sizeSection} from "./sizeView";
import {stopSection} from "./stopView";
import {twapSection} from "./twapView";
import {isValidLimitOrder, isValidMarketOrder} from "./validation";

export const view = (state$: Stream<State>): Stream<VNode> =>
    state$.map((state) =>
        div(".order", [
            sizeSection(state),
            hr(),
            marketSection(state),
            hr(),
            limitSection(state),
            hr(),
            stopSection(state),
            hr(),
            twapSection(state),
            hr(),
            clearSection(state),
            hr(),
            ifdocoSection(state),
        ]),
    );

const marketSection = (state: State): VNode =>
    div([
        h4(".sub-title", "Market"),
        div(".market-order-buttons.order-buttons", sideButtons(state.isOrdering || !isValidMarketOrder(state))),
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
                { attrs: { disabled: state.isOrdering || state.position.size === 0 } },
                "Clear Position",
            ),
            button(".clear-order-button", { attrs: { disabled: clearOrderButtonDisabled(state) } }, "Clear Orders"),
        ]),
    ]);

const clearOrderButtonDisabled = (state: State): boolean =>
    state.isOrdering || (state.orders.length + state.stopOrders.length) === 0;
