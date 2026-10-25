import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {IFDOCOrder} from "../../../models/ifdocoOrder";
import {Order} from "../../../models/order";
import {Position} from "../../../models/position";
import {StopOrder} from "../../../models/stopOrder";
import {State} from "./index";
import {Actions} from "./intent";

const defaultState: State = {
    currentPrice: 0,
    histories: [],
    ifdocoOrder: new IFDOCOrder(10000, 50),
    isOrdering: false,
    orders: [],
    position: new Position([]),
    price: 0,
    size: 0,
    stopOrders: [],
};

export const model = (actions: Actions): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const cancelOrdersReducer$ = actions.onCancelOrders$
        .map((_) => (state: State) => ({ ...state, orders: [] as Order[], stopOrders: [] as StopOrder[] }));

    const historyReducer$ = actions.onHistoryCreated$
        .map((history) => (state: State) => ({ ...state, histories: [history].concat(state.histories)}));

    const isOrderingReducer$ = Stream.merge(
        actions.onClickMarketBuyButton$.mapTo(true),
        actions.onClickMarketSellButton$.mapTo(true),
        actions.onClickLimitBuyButton$.mapTo(true),
        actions.onClickLimitSellButton$.mapTo(true),
        actions.onClickClearButton$.mapTo(true),
        actions.onHistoryCreated$.mapTo(false),
    ).map((isOrdering) => (state: State) => ({ ...state, isOrdering }));

    const priceReducer$ = actions.onPriceChanged$
        .map((price) => (state: State) => ({ ...state, price }));

    const priceWidthReducer$ = Stream.merge(actions.onPriceWidthChanged$, actions.onPriceWidthLoaded$)
        .map((price) => (state: State) => ({ ...state, ifdocoOrder: new IFDOCOrder(price, state.ifdocoOrder.ratio) }));

    const ratioReducer$ = Stream.merge(actions.onRatioChanged$, actions.onRatioLoaded$)
        .map((ratio) => (state: State) => ({ ...state, ifdocoOrder: new IFDOCOrder(state.ifdocoOrder.width, ratio) }));

    const sizeReducer$ = Stream.merge(actions.onSizeChanged$, actions.onSizeLoaded$, actions.onClickSizePresetButton$)
        .map((size) => (state: State) => ({ ...state, size }));

    return Stream.merge(
        defaultReducer$,
        cancelOrdersReducer$,
        historyReducer$,
        isOrderingReducer$,
        priceReducer$,
        priceWidthReducer$,
        ratioReducer$,
        sizeReducer$,
    ) as Stream<Reducer<State>>;
};
