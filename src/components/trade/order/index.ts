import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {Sound} from "../../../drivers/soundDriver";
import {IFDOCOrder} from "../../../models/ifdocoOrder";
import {Order} from "../../../models/order";
import {OrderHistory} from "../../../models/orderHistory";
import {Position} from "../../../models/position";
import {StopOrder} from "../../../models/stopOrder";
import {TwapOrder} from "../../../models/twapOrder";
import {Sinks, Sources} from "../index";
import "./index.styl";
import {intent} from "./intent";
import {model} from "./model";
import {orderRequests} from "./request";
import {storage} from "./storage";
import {twapRequest} from "./twapRequest";
import {view} from "./view";

export interface State {
    currentPrice: number;
    histories: OrderHistory[];
    ifdocoOrder: IFDOCOrder;
    isOrdering: boolean;
    orders: Order[];
    position: Position;
    price: number;
    size: number;
    stopOrders: StopOrder[];
    triggerPrice: number;
    twap: TwapOrder;
}

export const OrderComponent = (sources: Sources, isOrdering$: Stream<boolean>): Sinks & {
    orderRequests: Stream<RequestInput>;
    sound: Stream<Sound>;
} => {
    const state$ = sources.state.stream as any as Stream<State>;
    const actions = intent(sources);
    const reducer$ = model(actions, isOrdering$);
    const view$ = view(state$);

    return {
        DOM: view$,
        HTTP: twapRequest(actions, state$).map<RequestInput | null>((input) => input),
        orderRequests: orderRequests(actions, state$),
        router: Stream.never(),
        sound: Stream.merge(actions.onOrderOutcome$, actions.onTwapSliceOutcome$)
            .map(({ status }): Sound => status === "success" ? "success" : "failure"),
        state: reducer$ as any,
        storage: storage(state$),
    };
};
