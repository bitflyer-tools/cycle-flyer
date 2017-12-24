import Stream from "xstream";
import {model} from "./model";
import {intent} from "./intent";
import {request} from "./request";
import {view} from "./view";
import {Sources} from "../index";
import {Sinks} from "../../index";
import {OrderHistory} from "../../../models/orderHistory";
import {Position} from "../../../models/position";
import "./index.styl"

export interface State {
    collateral: number;
    currentPrice: number;
    histories: OrderHistory[];
    marketState: object;
    position: Position;
}

export const Summary = (sources: Sources): Sinks => {
    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(sources.onion.state$);
    const request$ = request();

    return {
        DOM: view$,
        HTTP: request$,
        onion: reducer$,
        router: Stream.empty(),
        storage: Stream.empty()
    }
};
