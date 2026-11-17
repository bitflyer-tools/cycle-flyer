import {RequestInput} from "@cycle/http";
import Stream from "xstream";
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
import {submissions} from "./request";
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

export const OrderComponent = (sources: Sources): Sinks => {
    const state$ = sources.state.stream as any as Stream<State>;
    const actions = intent(sources);
    const pending$ = submissions(actions, state$, sources.HTTP);
    const reducer$ = model(actions, pending$.map((pending) => pending !== null));
    const view$ = view(state$);
    const request$ = Stream.merge(
        pending$.filter((pending) => pending !== null),
        twapRequest(actions, state$),
    ).map<RequestInput | null>((input) => input);

    return {
        DOM: view$,
        HTTP: request$,
        router: Stream.never(),
        state: reducer$ as any,
        storage: storage(state$),
    };
};
