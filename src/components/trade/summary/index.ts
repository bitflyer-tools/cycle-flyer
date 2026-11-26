import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {Sound} from "../../../drivers/soundDriver";
import {OrderHistory} from "../../../models/orderHistory";
import {Position} from "../../../models/position";
import {Sinks} from "../../index";
import {Sources} from "../index";
import {PriceAlert} from "../priceAlert";
import "./index.styl";
import {intent} from "./intent";
import {model} from "./model";
import {request} from "./request";
import {view} from "./view";

export interface State {
    collateral: number;
    currentPrice: number | null;
    histories: readonly OrderHistory[];
    marketState: any;
    position: Position;
    priceAlert: PriceAlert | null;
}

export const SummaryComponent = (sources: Sources): Sinks => {
    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(sources.state.stream as any);
    const request$ = request();

    const alertTriggered$ = (sources.state.stream as any)
        .map((state: State | undefined) => state?.priceAlert)
        .compose(dropRepeats())
        .drop(1)
        .filter((alert: PriceAlert | null | undefined) => alert?.status === "triggered")
        .mapTo<Sound>("price-alert");

    return {
        DOM: view$,
        HTTP: request$,
        notification: alertTriggered$,
        router: Stream.never(),
        sound: alertTriggered$,
        state: reducer$,
        storage: Stream.never(),
    };
};
