import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {
    cancelOrders,
    getOrders,
    getParentOrder,
    getParentOrders,
    getPositions,
    ifdocoOrder,
    limitOrder,
    marketOrder,
} from "../../http";
import {State} from "./index";
import {Actions} from "./intent";

export const request = (actions: Actions, state$: Stream<State>): Stream<string | RequestInput | null> => {
    const orders = Stream.periodic(10000).mapTo(getOrders()).startWith(getOrders());
    const parentOrders = Stream.periodic(10000).mapTo(getParentOrders()).startWith(getParentOrders());
    const positions = Stream.periodic(10000).mapTo(getPositions()).startWith(getPositions());

    const ifdocoOrders = actions.onIFDOCOOrdersLoaded$
        .map((os) => Stream.fromArray(os.map((order: any) => getParentOrder(order.parent_order_id))))
        .flatten();

    const marketBuy = actions.onClickMarketBuyButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.size, "BUY"));

    const marketSell = actions.onClickMarketSellButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.size, "SELL"));

    const limitBuy = actions.onClickLimitBuyButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => limitOrder(state.price, state.size, "BUY"));

    const limitSell = actions.onClickLimitSellButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => limitOrder(state.price, state.size, "SELL"));

    const clear = actions.onClickClearButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) => marketOrder(state.position.size, state.position.side === "BUY" ? "SELL" : "BUY"));

    const clearOrders = actions.onClickClearOrderButton$
        .map((_) => cancelOrders());

    const ifdocoBuy = actions.onClickIFDOCOBuyButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) =>
            ifdocoOrder(
                state.ifdocoOrder.buyProfitLine(state.currentPrice),
                state.ifdocoOrder.buyLossLine(state.currentPrice),
                state.size,
                "BUY",
            ),
        );

    const ifdocoSell = actions.onClickIFDOCOSellButton$
        .compose(sampleCombine(state$))
        .map(([_, state]) =>
            ifdocoOrder(
                state.ifdocoOrder.sellProfitLine(state.currentPrice),
                state.ifdocoOrder.sellLossLine(state.currentPrice),
                state.size,
                "SELL",
            ),
        );

    return Stream.merge(
        orders,
        parentOrders,
        positions,
        marketBuy,
        marketSell,
        limitBuy,
        limitSell,
        ifdocoBuy,
        ifdocoSell,
        ifdocoOrders,
        clear,
        clearOrders,
    ) as Stream<string | RequestInput | null>;
};
