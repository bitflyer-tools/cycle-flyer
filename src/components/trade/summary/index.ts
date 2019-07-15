import Stream from "xstream";
import {OrderHistory} from "../../../models/orderHistory";
import {Position} from "../../../models/position";
import {Sinks} from "../../index";
import {Sources} from "../index";
import "./index.styl";
import {intent} from "./intent";
import {model} from "./model";
import {request} from "./request";
import {view} from "./view";

export interface State {
    collateral: number;
    currentPrice: number;
    histories: OrderHistory[];
    marketState: object;
    position: Position;
}

export const SummaryComponent = (sources: Sources): Sinks => {
    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(sources.onion.state$);
    const request$ = request();

    return {
        DOM: view$,
        HTTP: request$,
        onion: reducer$,
        router: Stream.empty(),
        storage: Stream.empty(),
    };
};
