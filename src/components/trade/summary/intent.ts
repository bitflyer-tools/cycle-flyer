import {MainDOMSource} from "@cycle/dom";
import {Stream} from "xstream";
import {Sources} from "../index";
import {parsePriceAlertLevel, PriceAlertLevel} from "../priceAlert";

export interface Actions {
    onCollateralLoaded$: Stream<number>;
    onPriceAlertSet$: Stream<PriceAlertLevel>;
    onPriceAlertDismissed$: Stream<null>;
    onStateLoaded$: Stream<object>;
}

export const intent = (sources: Sources): Actions => {
    const onCollateralLoaded$ = sources.HTTP.select("collateral")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .filter((response) => !!response)
        .map((response) => JSON.parse(response.text).collateral);

    const onStateLoaded$ = sources.HTTP.select("status")
        .map((response$) => response$.replaceError(() => Stream.never()))
        .flatten()
        .filter((response) => !!response)
        .map((response) => JSON.parse(response.text));

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
