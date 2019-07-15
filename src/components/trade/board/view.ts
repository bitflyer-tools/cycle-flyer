import {button, div, span, VNode} from "@cycle/dom";
import Stream from "xstream";
import throttle from "xstream/extra/throttle";
import {State} from "./index";
import {BoardOrder} from "../../../models/board";
import {ceilBy, floorBy} from "../../../util";
import {StopOrder} from "../../../models/stopOrder";
import {Order} from "../../../models/order";

export const view = (state$: Stream<State>) =>
    state$
        .compose(throttle(100))
        .map(state =>
            div(".board", [
                div(".board-header",[
                    span("Group"),
                    button(".minus", "-"),
                    span(".grouped-size", state.groupedSize),
                    button(".plus", "+"),
                    span("Spread"),
                    span(".spread", state.board.spread().toLocaleString())
                ]),
                div(".asks", state.board.groupedAsks(state.groupedSize).map(ask =>
                    div(".ask", { dataset: { price: ask.price } }, [
                        span(".bar", { style: barStyle(ask.size) }),
                        myPosition(state, ask),
                        myOrder("SELL", state, ask),
                        myStopOrder("SELL", state, ask),
                        span(padWithZero(ask.size)),
                        span(ask.price.toLocaleString())
                    ])
                )),
                div(".bids", state.board.groupedBids(state.groupedSize).map(bid =>
                    div(".bid", { dataset: { price: bid.price } }, [
                        span(".bar", { style: barStyle(bid.size) } ),
                        span(bid.price.toLocaleString()),
                        span(padWithZero(bid.size)),
                        myOrder("BUY", state, bid),
                        myStopOrder("BUY", state, bid),
                        myPosition(state, bid)
                    ])
                ))
            ])
        );

const padWithZero = (number: number): string => number.toFixed(8).toString();

const barStyle = (size: number): object => {
    const s = size / 50 * 100;
    const width = s > 100 ? 100 : s;
    return { width: `${width}%` };
};

const myPosition = (state: State, order: BoardOrder): VNode | undefined => {
    const price = state.position.price;
    if (state.position.side === "SELL") {
        if (price === 0 || ceilBy(price, state.groupedSize) !== order.price) { return; }
    } else {
        if (price === 0 || floorBy(price, state.groupedSize) !== order.price) { return; }
    }
    return span(".my-position", "💰");
};

const myOrder = (side: string, state: State, boardOrder: BoardOrder): VNode | undefined => {
    const orders = state.orders.filter(order => matchOrder(side, order, boardOrder, state.groupedSize));
    if (orders.length === 0) {
        return;
    } else {
        return span(".my-order", orders.reduce((acc, order) => acc + order.size, 0).toString());
    }
};

const myStopOrder = (side: string, state: State, order: BoardOrder): VNode | undefined => {
    const orders = state.stopOrders.filter(stopOrder => matchOrderInv(side, stopOrder, order, state.groupedSize));
    if (orders.length === 0) {
        return;
    } else {
        return span(".my-stop-order", orders.reduce((acc, order) => acc + order.size, 0).toString());
    }
};

const matchOrder = (side: string, order: Order | StopOrder, boardOrder: BoardOrder, groupedSize: number): boolean => {
    if (side === "SELL") {
        return order.side === "SELL" && ceilBy(order.price, groupedSize) === boardOrder.price;
    } else if (side === "BUY") {
        return order.side === "BUY" && floorBy(order.price, groupedSize) === boardOrder.price;
    } else {
        return false;
    }
};

const matchOrderInv = (side: string, order: Order | StopOrder, boardOrder: BoardOrder, groupedSize: number): boolean => {
    if (side === "SELL") {
        return order.side === "BUY" && floorBy(order.price, groupedSize) === boardOrder.price;
    } else if (side === "BUY") {
        return order.side === "SELL" && ceilBy(order.price, groupedSize) === boardOrder.price;
    } else {
        return false;
    }
};
