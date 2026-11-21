import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {Sound} from "../../../drivers/soundDriver";
import {IFDOCOrder} from "../../../models/ifdocoOrder";
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
    credentialVersion?: symbol;
    currentPrice: number;
    histories: readonly OrderHistory[];
    ifdocoOrder: IFDOCOrder;
    isOrdering: boolean;
    orders: Order[];
    parentStopOrders: ParentStopOrders;
    position: Position;
    positionClosePending?: boolean;
    price: number;
    size: number;
    triggerPrice: number;
    twap: TwapOrder;
}

export const OrderComponent = (sources: Sources, isOrdering$: Stream<boolean>): Sinks & {
    orderRequests: Stream<OrderRequestBatch>;
    sound: Stream<Sound>;
} => {
    const state$ = sources.state.stream as any as Stream<State>;
    const actions = intent(sources, state$);
    const reducer$ = model(actions, isOrdering$);
    const view$ = view(state$);

    return {
        DOM: view$,
        HTTP: twapRequest(actions, state$).map<RequestInput | null>((input) => input),
        orderRequests: orderRequests(actions, state$),
        router: Stream.never(),
        sound: actions.onTwapSliceOutcome$
            .map(({ status }): Sound => status === "success" ? "success" : "failure"),
        state: reducer$ as any,
        storage: storage(state$),
    };
};
