import {button, div, span, VNode} from "@cycle/dom";
import Stream, {Listener} from "xstream";
import {BoardOrder} from "../../../models/boardOrder";
import {Order} from "../../../models/order";
import {StopOrder} from "../../../models/stopOrder";
import {ceilBy, floorBy} from "../../../util";
import {State} from "./";

export const view = (state$: Stream<State>) => {
    const orderTotals = memoizeMarkerTotals(false);
    const stopTotals = memoizeMarkerTotals(true);

    return state$
        .compose(throttleBoardState)
        .map((state) => {
            const orders = orderTotals(state.orders, state.groupedSize);
            const stops = stopTotals(state.stopOrders, state.groupedSize);

            return div(".board", [
                div(".board-header", [
                    span("Group"),
                    button(".minus", "-"),
                    span(".grouped-size", state.groupedSize),
                    button(".plus", "+"),
                    span("Spread"),
                    span(".spread", state.board.spread().toLocaleString()),
                ]),
                div(".asks", state.board.groupedAsks(state.groupedSize).map((ask: BoardOrder) =>
                    div(".ask", { dataset: { price: ask.price } }, [
                        span(".bar", { style: barStyle(ask.size) }),
                        myPosition(state, ask),
                        marker(".my-order", orders.asks.get(ask.price)),
                        marker(".my-stop-order", stops.asks.get(ask.price)),
                        span(padWithZero(ask.size)),
                        span(ask.price.toLocaleString()),
                    ]),
                )),
                div(".bids", state.board.groupedBids(state.groupedSize).map((bid: BoardOrder) =>
                    div(".bid", { dataset: { price: bid.price } }, [
                        span(".bar", { style: barStyle(bid.size) } ),
                        span(bid.price.toLocaleString()),
                        span(padWithZero(bid.size)),
                        marker(".my-order", orders.bids.get(bid.price)),
                        marker(".my-stop-order", stops.bids.get(bid.price)),
                        myPosition(state, bid),
                    ]),
                )),
            ]);
        });
};

const throttleBoardState = (state$: Stream<State>): Stream<State> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: State | undefined;
    let listener: Listener<State>;

    return Stream.create<State>({
        start(output) {
            const emit = (state: State) => {
                timer = setTimeout(() => {
                    timer = undefined;
                    const latest = pending;
                    pending = undefined;
                    if (latest) { emit(latest); }
                }, 100);
                output.next(state);
            };

            listener = {
                next(state) {
                    if (timer === undefined) { emit(state); }
                    else { pending = state; }
                },
                error: (error) => output.error(error),
                complete() {
                    if (pending) { output.next(pending); }
                    output.complete();
                },
            };
            state$.addListener(listener);
        },
        stop() {
            clearTimeout(timer);
            timer = undefined;
            pending = undefined;
            state$.removeListener(listener);
        },
    });
};

const padWithZero = (n: number): string => n.toFixed(8).toString();

const barStyle = (size: number): object => {
    const s = size / 50 * 100;
    const width = s > 100 ? 100 : s;
    return { width: `${width}%` };
};

const myPosition = (state: State, order: BoardOrder): VNode | null => {
    const price = state.position.price;
    if (state.position.side === "SELL") {
        if (price === 0 || ceilBy(price, state.groupedSize) !== order.price) { return null; }
    } else {
        if (price === 0 || floorBy(price, state.groupedSize) !== order.price) { return null; }
    }
    return span(".my-position", "💰");
};

const marker = (selector: string, total: number | undefined): VNode | null =>
    total === undefined ? null : span(selector, total.toString());

const memoizeMarkerTotals = (isStop: boolean) => {
    let previousOrders: ReadonlyArray<Order | StopOrder> | undefined;
    let previousGroupedSize: number | undefined;
    let totals: ReturnType<typeof groupMarkerTotals>;

    return (orders: ReadonlyArray<Order | StopOrder>, groupedSize: number) => {
        if (orders !== previousOrders || groupedSize !== previousGroupedSize) {
            totals = groupMarkerTotals(orders, groupedSize, isStop);
            previousOrders = orders;
            previousGroupedSize = groupedSize;
        }
        return totals;
    };
};

const groupMarkerTotals = (orders: ReadonlyArray<Order | StopOrder>, groupedSize: number, isStop: boolean) => {
    const asks = new Map<number, number>();
    const bids = new Map<number, number>();

    orders.forEach((order) => {
        const side = order.side;
        if (side !== "BUY" && side !== "SELL") { return; }
        const isSell = side === "SELL";
        const price = isSell ? ceilBy(order.price, groupedSize) : floorBy(order.price, groupedSize);
        if (Number.isNaN(price)) { return; }
        const buckets = isSell !== isStop ? asks : bids;
        buckets.set(price, (buckets.get(price) ?? 0) + order.size);
    });

    return { asks, bids };
};
