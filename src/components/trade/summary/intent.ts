import {MainDOMSource} from "@cycle/dom";
import {Stream} from "xstream";
import {Sources} from "../index";
import {pollResponse} from "../pollResponse";
import {parsePriceAlertLevel, PriceAlertLevel} from "../priceAlert";

export interface Actions {
    onCollateralLoaded$: Stream<number>;
    onPriceAlertSet$: Stream<PriceAlertLevel>;
    onPriceAlertDismissed$: Stream<null>;
    onStateLoaded$: Stream<object>;
}

export const intent = (sources: Sources): Actions => {
    const onCollateralLoaded$ = pollResponse<number>(sources.HTTP.select("collateral"), (json) =>
        Number.isFinite(json?.collateral) ? json.collateral : undefined);

    const onStateLoaded$ = pollResponse<object>(sources.HTTP.select("status"), (json) =>
        typeof json?.health === "string" && typeof json.state === "string" ? json : undefined);

    const dom = sources.DOM as MainDOMSource;
    const onPriceAlertSet$ = dom.select(".price-alert-form")
        .events("submit", { preventDefault: true }, true)
        .map((event) => readPriceAlertLevel(event.target as HTMLFormElement))
        .filter((level): level is PriceAlertLevel => level !== null);
    const onPriceAlertDismissed$ = dom.select(".dismiss-price-alert").events("click").mapTo(null);

    return {
        onPriceAlertDismissed$,
        onPriceAlertSet$,
        onCollateralLoaded$,
        onStateLoaded$,
    };
};

const readPriceAlertLevel = (form: HTMLFormElement): PriceAlertLevel | null => {
    const threshold = form.elements.namedItem("threshold") as HTMLInputElement;
    const direction = form.elements.namedItem("direction") as HTMLSelectElement;
    return parsePriceAlertLevel(threshold.valueAsNumber, direction.value);
};
