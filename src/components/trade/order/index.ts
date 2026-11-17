import Stream from "xstream";
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
import {request} from "./request";
import {storage} from "./storage";
import {view} from "./view";

export interface State {
    currentPrice: number;
    histories: OrderHistory[];
    ifdocoOrder: IFDOCOrder;
    isOrdering: boolean;
    orders: Order[];
    parentStopOrders: ParentStopOrders;
    position: Position;
    price: number;
    size: number;
    triggerPrice: number;
    twap: TwapOrder;
}

export const OrderComponent = (sources: Sources): Sinks => {
    const state$ = sources.state.stream as any as Stream<State>;
    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(state$);
    const request$ = request(actions, state$);

    return {
        DOM: view$,
        HTTP: request$,
        router: Stream.never(),
        state: reducer$ as any,
        storage: storage(state$),
    };
};
