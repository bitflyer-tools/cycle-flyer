import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {IFDOCOrder} from "../../../models/ifdocoOrder";
import {Position} from "../../../models/position";
import {defaultTwapOrder} from "../../../models/twapOrder";
import {State} from "./index";
import {Actions} from "./intent";
import {twapModel} from "./twapModel";

const defaultState: State = {
    currentPrice: 0,
    histories: [],
    ifdocoOrder: new IFDOCOrder(10000, 50),
    isOrdering: false,
    orders: [],
    parentStopOrders: {},
    position: new Position([]),
    price: 0,
    size: 0,
    triggerPrice: 0,
    twap: defaultTwapOrder,
};

export const model = (actions: Actions, isOrdering$: Stream<boolean>): Stream<Reducer<State>> => {
    const defaultReducer$ = Stream.of((state: State) => state || defaultState);

    const isOrderingReducer$ = isOrdering$
        .map((isOrdering) => (state: State) => ({ ...state, isOrdering }));

    const priceReducer$ = actions.onPriceChanged$
        .map((price) => (state: State) => ({ ...state, price }));

    const priceWidthReducer$ = Stream.merge(actions.onPriceWidthChanged$, actions.onPriceWidthLoaded$)
        .map((price) => (state: State) => ({ ...state, ifdocoOrder: new IFDOCOrder(price, state.ifdocoOrder.ratio) }));

    const ratioReducer$ = Stream.merge(actions.onRatioChanged$, actions.onRatioLoaded$)
        .map((ratio) => (state: State) => ({ ...state, ifdocoOrder: new IFDOCOrder(state.ifdocoOrder.width, ratio) }));

    const sizeReducer$ = Stream.merge(actions.onSizeChanged$, actions.onSizeLoaded$, actions.onClickSizePresetButton$)
        .map((size) => (state: State) => ({ ...state, size }));

    const triggerPriceReducer$ = actions.onTriggerPriceChanged$
        .map((triggerPrice) => (state: State) => ({ ...state, triggerPrice }));

    return Stream.merge(
        defaultReducer$,
        isOrderingReducer$,
        priceReducer$,
        priceWidthReducer$,
        ratioReducer$,
        sizeReducer$,
        triggerPriceReducer$,
        twapModel(actions),
    ) as Stream<Reducer<State>>;
};
