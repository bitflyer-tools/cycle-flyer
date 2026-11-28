import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {IFDOCOrder} from "../../../models/ifdocoOrder";
import {MarketFills} from "../../../models/marketFill";
import {Order} from "../../../models/order";
import {OrderHistory} from "../../../models/orderHistory";
import {ParentStopOrders} from "../../../models/parentStopOrders";
import {Position} from "../../../models/position";
import {TwapOrder} from "../../../models/twapOrder";
import {Sinks, Sources} from "../index";
import "./index.styl";
import {intent} from "./intent";
import {model} from "./model";
import {OrderRequestBatch, orderRequests} from "./request";
import {storage} from "./storage";
import {twapRequest} from "./twapRequest";
import {view} from "./view";

export interface State {
    currentPrice: number;
    histories: readonly OrderHistory[];
    ifdocoOrder: IFDOCOrder;
    isOrdering: boolean;
    marketFills?: MarketFills;
    orders: Order[];
    orderSigningError?: string;
    parentStopOrders: ParentStopOrders;
    position: Position;
    positionCredentialVersion?: number;
    positionExpiresAt?: number;
    positionStale?: boolean;
    positionClosePending?: boolean;
    price: number;
    size: number;
    triggerPrice: number;
    twap: TwapOrder;
}

export const OrderComponent = (
    sources: Sources,
    isOrdering$: Stream<boolean>,
    leaveTrade$?: Stream<void>,
    viewState$?: Stream<State>,
): Sinks & {
    orderRequests: Stream<OrderRequestBatch>;
} => {
    const state$ = sources.state.stream as any as Stream<State>;
    const actions = intent(sources, state$);
    const twap = twapRequest(actions, state$, sources.HTTP, leaveTrade$);
    const reducer$ = model(actions, isOrdering$, twap.lifecycle$);
    const view$ = view(viewState$ ?? state$);

    return {
        DOM: view$,
        HTTP: twap.requests$.map<RequestInput | null>((input) => input),
        orderRequests: orderRequests(actions, state$),
        router: Stream.never(),
        state: reducer$ as any,
        storage: storage(state$),
    };
};
